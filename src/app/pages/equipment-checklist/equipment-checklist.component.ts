import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom } from 'rxjs';
import * as QRCode from 'qrcode';
import { FirebaseAuthService } from '../../services/firebase-auth.service';
import {
  dateKey,
  daysOfMonth,
  EquipmentChecklistService,
  frequencyLabel,
  isClosed,
  periodDone
} from '../../services/equipment-checklist.service';
import {
  categoryName,
  checklistNames,
  EQUIPMENT_CATEGORIES,
  subcategoryName
} from './equipment-checklist.catalog';
import { SEED_CATEGORIES } from './equipment-checklist.seed';
import {
  Equipment,
  EquipmentStaff,
  InspectionFrequency,
  InspectionRecord,
  InspectionResult,
  MaintenanceBy,
  MaintenanceCycle
} from './equipment-checklist.models';

type PageView = 'check' | 'list' | 'groups' | 'items' | 'history' | 'labels' | 'scan' | 'staff';
type ResultFilter = 'all' | 'NOT_CHECKED' | 'PASS' | 'FAIL';

@Component({
  selector: 'app-equipment-checklist',
  templateUrl: './equipment-checklist.component.html',
  styleUrls: ['./equipment-checklist.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EquipmentChecklistComponent implements OnInit, OnDestroy {
  @ViewChild('excelInput') excelInput?: ElementRef<HTMLInputElement>;
  @ViewChild('scanBox') scanBox?: ElementRef<HTMLInputElement>;
  @ViewChild('mobileScanBox') mobileScanBox?: ElementRef<HTMLInputElement>;

  readonly categories = EQUIPMENT_CATEGORIES;
  readonly categoryName = categoryName;
  readonly subcategoryName = subcategoryName;
  readonly frequencyLabel = frequencyLabel;

  view: PageView = 'check';
  collapsed = new Set<string>();
  private collapseReady = false;
  searchQuery = '';
  userName = '';
  userRole = '';
  itemRows: Array<{ name: string; result: 'PASS' | 'FAIL' | ''; note: string }> = [];
  readonly donutColors = ['#3b82f6', '#f59e0b', '#eab308', '#a855f7', '#22c55e'];
  readonly roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  loading = false;
  message = '';
  messageError = false;

  year = new Date().getFullYear();
  month = new Date().getMonth() + 1;
  selectedDay = new Date().getDate();

  filterCategory = '';
  filterSubcategory = '';
  filterPerson = '';
  filterStatus = '';
  filterResult: ResultFilter = 'all';
  searchName = '';
  searchCode = '';

  equipment: Equipment[] = [];
  records: InspectionRecord[] = [];
  staff: EquipmentStaff[] = [];
  staffName = '';
  staffCode = '';
  checklistGroups: Array<{ name: string; subs: Array<{ id: string; name: string; items: string[] }> }> = [];
  maintenanceItems: string[] = [];
  scanBuffer = '';
  private scanLock = false;

  showForm = false;
  editing = false;
  form: Equipment = this.emptyEquipment();
  showDelete = false;
  deletePassword = '';
  deleteError = '';
  deleting = false;
  showInspect = false;

  dialogOpen = false;
  dialogEquipment: Equipment | null = null;
  dialogDate = '';
  dialogInspector = '';
  dialogResult: InspectionResult = 'PASS';
  dialogNotes = '';
  dialogDefect = '';
  dialogAction = '';
  dialogImage = '';
  dialogChecks = new Set<string>();
  dialogSaving = false;

  historyEquipment: Equipment | null = null;
  history: InspectionRecord[] = [];

  labelSelection = new Set<string>();
  labelImages = new Map<string, string>();

  scanOn = false;
  scanError = '';
  mobileUi = false;
  mobileStep: 'staff' | 'equip' | 'form' | 'done' = 'staff';
  mobileScanBy: 'pda' | 'camera' = 'pda';
  mobileStaff: EquipmentStaff | null = null;
  private scanner: { stop: () => Promise<void> } | null = null;

  zaloSending = false;

  constructor(
    private api: EquipmentChecklistService,
    private auth: FirebaseAuthService,
    private fns: AngularFireFunctions,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    const seeded = await this.api.ensureSeeded().catch(() => 0);
    const user = await firstValueFrom(this.auth.user$);
    this.userName = user?.displayName || user?.employeeId || '';
    this.userRole = user?.role || '';
    await this.reload();
    if (seeded) this.flash(`Đã nạp ${seeded} thiết bị ban đầu.`);
    this.mobileUi = this.isHandheld();
    if (this.mobileUi) {
      this.cdr.detectChanges();
      this.focusMobileScan();
    }
  }

  ngOnDestroy(): void {
    void this.stopScan();
  }

  get days(): number[] {
    return daysOfMonth(this.year, this.month);
  }

  get people(): string[] {
    const set = new Set<string>();
    this.equipment.forEach(eq => {
      if (eq.responsiblePerson) set.add(eq.responsiblePerson);
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'vi'));
  }

  get categoryOptions(): Array<{ id: string; name: string }> {
    const map = new Map<string, string>();
    EQUIPMENT_CATEGORIES.forEach(c => map.set(c.categoryId, c.categoryName));
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }

  get subcategoryOptions(): Array<{ id: string; name: string }> {
    return EQUIPMENT_CATEGORIES
      .filter(c => !this.filterCategory || c.categoryId === this.filterCategory)
      .map(c => ({ id: c.subcategoryId, name: c.subcategoryName }));
  }

  get formSubcategories(): Array<{ id: string; name: string }> {
    return EQUIPMENT_CATEGORIES
      .filter(c => c.categoryId === this.form.categoryId)
      .map(c => ({ id: c.subcategoryId, name: c.subcategoryName }));
  }

  get filtered(): Equipment[] {
    const name = (this.searchQuery || this.searchName).trim().toLowerCase();
    const code = this.searchCode.trim().toLowerCase();
    const day = this.selectedDate();
    return this.equipment.filter(eq => {
      if (this.filterCategory && eq.categoryId !== this.filterCategory) return false;
      if (this.filterSubcategory && eq.subcategoryId !== this.filterSubcategory) return false;
      if (this.filterPerson && (eq.responsiblePerson || '') !== this.filterPerson) return false;
      if (this.filterStatus && eq.status !== this.filterStatus) return false;
      if (name && !eq.equipmentName.toLowerCase().includes(name) && !eq.managementCode.toLowerCase().includes(name)) return false;
      if (code && !eq.managementCode.toLowerCase().includes(code)) return false;
      if (this.filterResult !== 'all') {
        const result = this.resultOn(eq, day);
        if (this.filterResult === 'NOT_CHECKED') {
          if (periodDone(eq, this.records, day)) return false;
        } else if (result !== this.filterResult) return false;
      }
      return true;
    });
  }

  get activePool(): Equipment[] {
    return this.equipment.filter(eq => eq.status === 'ACTIVE' || eq.status === 'REPAIR');
  }

  get stats() {
    const day = this.selectedDate();
    const pool = this.activePool;
    let completed = 0;
    let passed = 0;
    let failed = 0;
    let na = 0;
    pool.forEach(eq => {
      if (!periodDone(eq, this.records, day)) return;
      completed += 1;
      const result = this.periodResult(eq, day);
      if (result === 'PASS') passed += 1;
      if (result === 'FAIL') failed += 1;
      if (result === 'NA') na += 1;
    });
    const total = pool.length;
    const repair = this.equipment.filter(eq => eq.status === 'REPAIR').length;
    return {
      total,
      completed,
      passed,
      failed,
      na,
      outstanding: total - completed,
      repair,
      checkedToday: this.records.filter(r => r.inspectionDate === this.todayKey() && isClosed(r.result)).length,
      completion: pct(completed, total),
      passRate: pct(passed, completed),
      failRate: pct(failed, completed)
    };
  }

  get reportByDay(): Array<{ day: number; completed: number; total: number }> {
    const total = this.activePool.length || 1;
    return this.days.map(day => {
      const key = dateKey(this.year, this.month, day);
      const completed = this.activePool.filter(eq => periodDone(eq, this.records, key)).length;
      return { day, completed, total };
    });
  }

  get reportByCategory(): Array<{ name: string; total: number; failed: number }> {
    const map = new Map<string, { name: string; total: number; failed: number }>();
    this.activePool.forEach(eq => {
      const name = categoryName(eq.categoryId);
      const row = map.get(eq.categoryId) || { name, total: 0, failed: 0 };
      row.total += 1;
      if (this.records.some(r => r.equipmentId === eq.equipmentId && r.result === 'FAIL' && r.inspectionDate.startsWith(`${this.year}-${String(this.month).padStart(2, '0')}`))) row.failed += 1;
      map.set(eq.categoryId, row);
    });
    return [...map.values()];
  }

  get reportByInspector(): Array<{ name: string; count: number; pass: number; fail: number }> {
    const map = new Map<string, { name: string; count: number; pass: number; fail: number }>();
    this.records.forEach(r => {
      if (!r.inspectionDate.startsWith(`${this.year}-${String(this.month).padStart(2, '0')}`)) return;
      if (!isClosed(r.result)) return;
      const name = r.inspector || '—';
      const row = map.get(name) || { name, count: 0, pass: 0, fail: 0 };
      row.count += 1;
      if (r.result === 'PASS') row.pass += 1;
      if (r.result === 'FAIL') row.fail += 1;
      map.set(name, row);
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  }

  cellDate(day: number): string {
    return dateKey(this.year, this.month, day);
  }

  get failedRecords(): InspectionRecord[] {
    const prefix = `${this.year}-${String(this.month).padStart(2, '0')}`;
    return this.records.filter(r => r.result === 'FAIL' && r.inspectionDate.startsWith(prefix));
  }

  goMenu(): void {
    void this.router.navigate(['/menu']);
  }

  async reload(): Promise<void> {
    this.loading = true;
    this.cdr.markForCheck();
    try {
      const [equipment, records, staff, catalog] = await Promise.all([
        this.api.listEquipment(),
        this.api.listInspections(this.year, this.month),
        this.api.listStaff(),
        this.api.loadItemCatalog()
      ]);
      this.equipment = equipment;
      this.records = records;
      this.staff = staff;
      this.applyCatalog(catalog.checklists, catalog.maintenanceItems);
      this.initCollapse();
      const max = daysOfMonth(this.year, this.month).length;
      if (this.selectedDay > max) this.selectedDay = max;
    } catch (e: unknown) {
      this.flash(e instanceof Error ? e.message : 'Không tải được dữ liệu.', true);
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  async onMonthChange(): Promise<void> {
    await this.reload();
  }

  resultOn(eq: Equipment, day: string): InspectionResult {
    const hit = this.records.find(r => r.equipmentId === eq.equipmentId && r.inspectionDate === day);
    return hit?.result || 'NOT_CHECKED';
  }

  mark(result: InspectionResult): string {
    if (result === 'PASS') return '✓';
    if (result === 'FAIL') return '✕';
    if (result === 'NA') return '–';
    return '○';
  }

  markTip(result: InspectionResult): string {
    return this.resultLabel(result);
  }

  itemsText(eq: Equipment): string {
    return this.namesFor(eq).join(', ');
  }

  openCreate(): void {
    this.editing = false;
    this.form = this.emptyEquipment();
    this.showForm = true;
  }

  openEdit(eq: Equipment): void {
    this.editing = true;
    this.form = { ...eq, checkBy: eq.checkBy || 'computer' };
    this.showForm = true;
  }

  onFormCategory(): void {
    const first = this.formSubcategories[0];
    if (first) this.form.subcategoryId = first.id;
  }

  async saveEquipment(): Promise<void> {
    try {
      await this.api.saveEquipment(this.form, !this.editing);
      this.showForm = false;
      this.flash(this.editing ? 'Đã cập nhật thiết bị.' : 'Đã thêm thiết bị.');
      await this.reload();
    } catch (e: unknown) {
      this.flash(e instanceof Error ? e.message : 'Không lưu được thiết bị.', true);
    }
  }

  async onExcel(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const rows = this.api.readExcel(buf);
      const result = await this.api.importEquipmentRows(rows, this.year, this.month);
      this.flash(`Import: thêm ${result.added}, cập nhật ${result.updated}, bỏ qua ${result.skipped} dòng thiếu tên hoặc mã, ${result.inspections} kết quả ngày.`);
      await this.reload();
    } catch (e: unknown) {
      this.flash(e instanceof Error ? e.message : 'Không đọc được Excel.', true);
    } finally {
      if (this.excelInput) this.excelInput.nativeElement.value = '';
    }
  }

  exportExcel(): void {
    this.api.exportMonth(this.filtered, this.records, this.year, this.month);
  }

  async openDay(eq: Equipment, day: number): Promise<void> {
    const date = dateKey(this.year, this.month, day);
    if (!this.canInspectDate(date)) {
      this.flash('Không kiểm tra trước ngày.', true);
      return;
    }
    const existing = this.records.find(r => r.equipmentId === eq.equipmentId && r.inspectionDate === date);
    const user = await firstValueFrom(this.auth.user$);
    this.dialogEquipment = eq;
    this.dialogDate = date;
    this.dialogInspector = existing?.inspector || user?.displayName || user?.employeeId || '';
    this.dialogResult = existing && existing.result !== 'NOT_CHECKED' ? existing.result : 'PASS';
    this.dialogNotes = existing?.notes || '';
    this.dialogDefect = existing?.defectDescription || '';
    this.dialogAction = existing?.correctiveAction || '';
    this.dialogImage = existing?.imageUrl || '';
    this.dialogChecks = new Set(existing?.checkedItems || this.namesFor(eq));
    const names = this.namesFor(eq);
    this.itemRows = names.map(name => {
      const hit = existing?.itemResults?.find(row => row.itemName === name);
      const checked = existing?.checkedItems?.includes(name);
      const result = hit?.result || (checked ? 'PASS' : '');
      return { name, result: result === 'FAIL' || result === 'PASS' ? result : '', note: hit?.note || '' };
    });
    this.selectedDay = day;
    this.dialogOpen = true;
    this.view = 'check';
    this.cdr.markForCheck();
  }

  async onPanelDate(): Promise<void> {
    if (!this.dialogEquipment || !/^\d{4}-\d{2}-\d{2}$/.test(this.dialogDate)) return;
    if (!this.canInspectDate(this.dialogDate)) {
      this.flash('Không kiểm tra trước ngày.', true);
      this.dialogDate = this.cellDate(this.selectedDay);
      this.cdr.markForCheck();
      return;
    }
    const [y, m, d] = this.dialogDate.split('-').map(Number);
    if (y !== this.year || m !== this.month) {
      this.year = y;
      this.month = m;
      await this.reload();
    }
    const eq = this.equipment.find(item => item.equipmentId === this.dialogEquipment?.equipmentId);
    if (eq) await this.openDay(eq, d);
  }

  onItemResult(row: { result: 'PASS' | 'FAIL' | '' }, value: string): void {
    row.result = value === 'FAIL' || value === 'PASS' ? value : '';
    if (value === 'FAIL') this.dialogResult = 'FAIL';
  }

  dialogItems(): string[] {
    if (!this.dialogEquipment) return [];
    return this.namesFor(this.dialogEquipment);
  }

  toggleCheck(item: string): void {
    if (this.dialogChecks.has(item)) this.dialogChecks.delete(item);
    else this.dialogChecks.add(item);
  }

  async onImage(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.dialogImage = await compressImage(file);
    this.cdr.markForCheck();
  }

  async saveInspection(): Promise<void> {
    if (!this.dialogEquipment) return;
    if (!this.canInspectDate(this.dialogDate)) {
      this.flash('Không kiểm tra trước ngày.', true);
      return;
    }
    if (this.dialogResult === 'FAIL' && !this.dialogDefect.trim()) {
      this.flash('Kết quả Không đạt cần mô tả lỗi.', true);
      return;
    }
    this.dialogSaving = true;
    try {
      await this.api.upsertInspection({
        inspectionId: '',
        equipmentId: this.dialogEquipment.equipmentId,
        inspectionDate: this.dialogDate,
        inspector: this.dialogInspector,
        result: this.dialogResult,
        notes: this.dialogNotes.trim(),
        defectDescription: this.dialogResult === 'FAIL' ? this.dialogDefect.trim() : '',
        correctiveAction: this.dialogAction.trim(),
        imageUrl: this.dialogImage,
        checkedItems: this.itemRows.filter(row => row.result === 'PASS').map(row => row.name),
        itemResults: this.itemRows.map(row => ({ itemName: row.name, result: row.result, note: row.note.trim() }))
      });
      const savedId = this.dialogEquipment.equipmentId;
      const savedDate = this.dialogDate;
      await this.reload();
      if (this.mobileUi) {
        this.dialogOpen = false;
        this.mobileStep = 'done';
        this.message = '';
        return;
      }
      this.flash('Đã lưu kiểm tra.');
      const fresh = this.equipment.find(item => item.equipmentId === savedId);
      if (fresh) await this.openDay(fresh, Number(savedDate.slice(8, 10)));
    } catch (e: unknown) {
      this.flash(e instanceof Error ? e.message : 'Không lưu được kết quả.', true);
    } finally {
      this.dialogSaving = false;
      this.cdr.markForCheck();
    }
  }

  async openHistory(eq: Equipment): Promise<void> {
    this.historyEquipment = eq;
    this.history = await this.api.listHistory(eq.equipmentId);
    this.cdr.markForCheck();
  }

  equipmentName(id: string): string {
    return this.equipment.find(e => e.equipmentId === id)?.equipmentName || id;
  }

  async openLabels(): Promise<void> {
    this.view = 'labels';
    await this.ensureLabelImages([...this.labelSelection]);
    this.cdr.markForCheck();
  }

  setView(view: PageView): void {
    if (this.view === 'scan' && view !== 'scan') void this.stopScan();
    if (view === 'labels') {
      void this.openLabels();
      return;
    }
    if (view === 'scan') {
      void this.startScan();
      return;
    }
    this.view = view;
    this.cdr.markForCheck();
  }

  isCollapsed(key: string): boolean {
    return this.collapsed.has(key);
  }

  toggleCollapse(key: string): void {
    if (this.collapsed.has(key)) this.collapsed.delete(key);
    else this.collapsed.add(key);
    this.cdr.markForCheck();
  }

  get grouped(): Array<{ id: string; name: string; roman: string; subs: Array<{ id: string; name: string; rows: Equipment[] }> }> {
    const filtering = !!(
      this.searchQuery.trim() || this.searchName.trim() || this.searchCode.trim() ||
      this.filterPerson || this.filterStatus || this.filterResult !== 'all' || this.filterSubcategory
    );
    return SEED_CATEGORIES.map((cat, index) => ({
      id: cat.id,
      name: cat.name,
      roman: this.roman[index] || String(index + 1),
      subs: cat.subcategories
        .filter(sub => !this.filterSubcategory || sub.id === this.filterSubcategory)
        .map(sub => ({
          id: sub.id,
          name: sub.name,
          rows: this.filtered.filter(eq => eq.subcategoryId === sub.id)
        }))
        .filter(sub => !filtering || sub.rows.length)
    })).filter(cat => {
      if (this.filterCategory && cat.id !== this.filterCategory) return false;
      if (filtering) return cat.subs.some(sub => sub.rows.length);
      return true;
    });
  }

  get monthBars(): Array<{ day: number; pass: number; fail: number; na: number; open: number }> {
    return this.days.map(day => {
      const key = dateKey(this.year, this.month, day);
      let pass = 0;
      let fail = 0;
      let na = 0;
      let open = 0;
      this.activePool.forEach(eq => {
        const result = this.resultOn(eq, key);
        if (result === 'PASS') pass += 1;
        else if (result === 'FAIL') fail += 1;
        else if (result === 'NA') na += 1;
        else open += 1;
      });
      return { day, pass, fail, na, open };
    });
  }

  get donutSlices(): Array<{ name: string; total: number; pct: number; color: string }> {
    const rows = this.reportByCategory;
    const total = rows.reduce((sum, row) => sum + row.total, 0) || 1;
    return rows.map((row, index) => ({
      name: row.name.replace(/^NHÓM THIẾT BỊ\s*/i, ''),
      total: row.total,
      pct: Math.round((row.total / total) * 100),
      color: this.donutColors[index % this.donutColors.length]
    }));
  }

  get donutStyle(): string {
    if (!this.donutSlices.length) return 'conic-gradient(#e2e8f0 0 100%)';
    let cursor = 0;
    const parts = this.donutSlices.map(slice => {
      const start = cursor;
      cursor += slice.pct;
      return `${slice.color} ${start}% ${cursor}%`;
    });
    if (cursor < 100) parts.push(`#e2e8f0 ${cursor}% 100%`);
    return `conic-gradient(${parts.join(',')})`;
  }

  get dueList(): Array<{ eq: Equipment; label: string; late: boolean }> {
    const day = this.selectedDate();
    return this.activePool
      .filter(eq => eq.status === 'ACTIVE' && !periodDone(eq, this.records, day))
      .slice(0, 5)
      .map(eq => {
        const last = this.records
          .filter(rec => rec.equipmentId === eq.equipmentId && isClosed(rec.result))
          .map(rec => rec.inspectionDate)
          .sort()
          .pop();
        if (!last) return { eq, label: 'Hôm nay', late: false };
        const gap = Math.round((Date.parse(`${day}T00:00:00`) - Date.parse(`${last}T00:00:00`)) / 86400000);
        if (gap <= 1) return { eq, label: 'Hôm nay', late: false };
        return { eq, label: `Quá hạn ${gap} ngày`, late: true };
      });
  }

  get inspectorOptions(): string[] {
    const set = new Set(this.people);
    if (this.userName) set.add(this.userName);
    if (this.dialogInspector) set.add(this.dialogInspector);
    return [...set].sort((a, b) => a.localeCompare(b, 'vi'));
  }

  get userInitials(): string {
    const parts = this.userName.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'NV';
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
  }

  get yearOptions(): number[] {
    const year = new Date().getFullYear();
    return [year - 1, year, year + 1, year + 2];
  }

  showAllDue(): void {
    this.filterResult = 'NOT_CHECKED';
    this.view = 'check';
    this.cdr.markForCheck();
  }

  closePanel(): void {
    this.dialogOpen = false;
    this.cdr.markForCheck();
  }

  statusLabel(status: string): string {
    if (status === 'ACTIVE') return 'Đang sử dụng';
    if (status === 'REPAIR') return 'Đang sửa chữa';
    if (status === 'INACTIVE') return 'Không sử dụng';
    if (status === 'SPARE') return 'Dự phòng';
    if (status === 'DISPOSED') return 'Đã thanh lý';
    return status;
  }

  askDelete(): void {
    if (!this.labelSelection.size) {
      this.flash('Chọn ít nhất một thiết bị để xóa.', true);
      return;
    }
    this.deletePassword = '';
    this.deleteError = '';
    this.showDelete = true;
    this.cdr.markForCheck();
  }

  async confirmDelete(): Promise<void> {
    if (this.deletePassword !== '2026') {
      this.deleteError = 'Sai mật khẩu.';
      this.cdr.markForCheck();
      return;
    }
    const ids = [...this.labelSelection];
    this.deleting = true;
    this.cdr.markForCheck();
    try {
      await this.api.deleteEquipment(ids);
      ids.forEach(id => this.labelSelection.delete(id));
      if (this.dialogEquipment && ids.includes(this.dialogEquipment.equipmentId)) this.dialogOpen = false;
      this.showDelete = false;
      this.deletePassword = '';
      this.flash(`Đã xóa ${ids.length} thiết bị.`);
      await this.reload();
    } catch (e: unknown) {
      this.flash(e instanceof Error ? e.message : 'Không xóa được thiết bị.', true);
    } finally {
      this.deleting = false;
      this.cdr.markForCheck();
    }
  }

  async saveRow(eq: Equipment): Promise<void> {
    eq.responsiblePerson = eq.responsiblePerson?.trim() || null;
    eq.responsibleEmployeeId = eq.responsibleEmployeeId?.trim().toUpperCase() || null;
    try {
      await this.api.saveEquipment(eq, false);
    } catch (e: unknown) {
      this.flash(e instanceof Error ? e.message : 'Không lưu được thiết bị.', true);
    }
  }

  async setFrequency(eq: Equipment, value: string): Promise<void> {
    eq.frequency = value === 'weekly' || value === 'monthly' ? value : 'daily';
    await this.saveRow(eq);
    this.cdr.markForCheck();
  }

  async setStatus(eq: Equipment, value: string): Promise<void> {
    if (value === 'REPAIR' || value === 'INACTIVE' || value === 'SPARE' || value === 'DISPOSED') eq.status = value;
    else eq.status = 'ACTIVE';
    await this.saveRow(eq);
    this.cdr.markForCheck();
  }

  async setCheckBy(eq: Equipment, value: string): Promise<void> {
    eq.checkBy = value === 'qr' ? 'qr' : 'computer';
    await this.saveRow(eq);
    this.cdr.markForCheck();
  }

  async setMaintenance(eq: Equipment, value: string): Promise<void> {
    const by: MaintenanceBy | null = value === 'internal' || value === 'external' ? value : null;
    eq.maintenanceBy = by;
    if (eq.maintenanceBy !== 'internal') eq.maintenanceCycle = null;
    await this.saveRow(eq);
    this.cdr.markForCheck();
  }

  async setMaintenanceCycle(eq: Equipment, value: string): Promise<void> {
    const cycle: MaintenanceCycle | null = value === 'quarter' || value === 'half' || value === 'year' ? value : null;
    eq.maintenanceCycle = cycle;
    await this.saveRow(eq);
    this.cdr.markForCheck();
  }

  addCheckItem(sub: { items: string[] }): void {
    sub.items.push('');
    this.cdr.markForCheck();
  }

  removeCheckItem(sub: { items: string[] }, index: number): void {
    sub.items.splice(index, 1);
    void this.saveCatalog();
  }

  addMaintenanceItem(): void {
    this.maintenanceItems.push('');
    this.cdr.markForCheck();
  }

  removeMaintenanceItem(index: number): void {
    this.maintenanceItems.splice(index, 1);
    void this.saveCatalog();
  }

  async saveCatalog(): Promise<void> {
    const checklists: Record<string, string[]> = {};
    this.checklistGroups.forEach(group => {
      group.subs.forEach(sub => {
        checklists[sub.id] = sub.items.map(item => item.trim()).filter(Boolean);
      });
    });
    try {
      await this.api.saveItemCatalog(checklists, this.maintenanceItems.map(item => item.trim()).filter(Boolean));
    } catch (e: unknown) {
      this.flash(e instanceof Error ? e.message : 'Không lưu được hạng mục.', true);
    }
  }

  isQrCheck(eq: Equipment): boolean {
    return eq.checkBy === 'qr';
  }

  checkedDay(eq: Equipment, day: number): boolean {
    return isClosed(this.resultOn(eq, this.cellDate(day)));
  }

  canInspectDay(day: number): boolean {
    return this.canInspectDate(this.cellDate(day));
  }

  openInspectDay(eq: Equipment, day: number): void {
    if (this.isQrCheck(eq)) return;
    if (!this.canInspectDay(day)) {
      this.flash('Không kiểm tra trước ngày.', true);
      return;
    }
    void this.openDay(eq, day);
  }

  get todayIso(): string {
    return this.todayKey();
  }

  async addStaff(): Promise<void> {
    try {
      await this.api.saveStaff({ employeeId: this.staffCode, name: this.staffName });
      this.staffName = '';
      this.staffCode = '';
      this.staff = await this.api.listStaff();
      this.flash('Đã thêm nhân viên.');
    } catch (e: unknown) {
      this.flash(e instanceof Error ? e.message : 'Không thêm được nhân viên.', true);
    }
  }

  async removeStaff(employeeId: string): Promise<void> {
    try {
      await this.api.deleteStaff(employeeId);
      this.staff = this.staff.filter(row => row.employeeId !== employeeId);
      this.flash('Đã xóa nhân viên.');
    } catch (e: unknown) {
      this.flash(e instanceof Error ? e.message : 'Không xóa được nhân viên.', true);
    }
  }

  resultLabel(result: string): string {
    if (result === 'PASS') return 'Đạt';
    if (result === 'FAIL') return 'Không đạt';
    if (result === 'NA') return 'Không áp dụng';
    return 'Chưa kiểm tra';
  }

  formatViDate(iso: string): string {
    const [y, m, d] = iso.split('-');
    if (!y || !m || !d) return iso;
    return `${d}/${m}/${y}`;
  }

  go(path: string): void {
    void this.router.navigate([path]);
  }

  async openHistoryRecord(rec: InspectionRecord): Promise<void> {
    const eq = this.equipment.find(item => item.equipmentId === rec.equipmentId);
    if (!eq) return;
    const [y, m, d] = rec.inspectionDate.split('-').map(Number);
    if (y !== this.year || m !== this.month) {
      this.year = y;
      this.month = m;
      await this.reload();
    }
    await this.openDay(eq, d);
  }

  get filteredSelected(): boolean {
    return this.filtered.length > 0 && this.filtered.every(eq => this.labelSelection.has(eq.equipmentId));
  }

  toggleAllFiltered(): void {
    const ids = this.filtered.map(eq => eq.equipmentId);
    if (this.filteredSelected) ids.forEach(id => this.labelSelection.delete(id));
    else ids.forEach(id => this.labelSelection.add(id));
    this.cdr.markForCheck();
  }

  toggleLabel(id: string): void {
    if (this.labelSelection.has(id)) this.labelSelection.delete(id);
    else this.labelSelection.add(id);
    this.cdr.markForCheck();
  }

  async printOne(eq: Equipment): Promise<void> {
    this.labelSelection = new Set([eq.equipmentId]);
    await this.printSelectedLabels();
  }

  async printSelectedLabels(): Promise<void> {
    if (!this.labelSelection.size) {
      this.flash('Chọn ít nhất một thiết bị để in tem.', true);
      return;
    }
    this.view = 'labels';
    await this.ensureLabelImages([...this.labelSelection]);
    this.cdr.detectChanges();
    window.print();
  }

  selectedLabels(): Equipment[] {
    return this.equipment.filter(eq => this.labelSelection.has(eq.equipmentId));
  }

  async startScan(): Promise<void> {
    this.view = 'scan';
    await this.openCamera('eq-qr-reader', () => this.scanBox?.nativeElement);
  }

  async startMobileScan(): Promise<void> {
    this.mobileScanBy = 'camera';
    this.cdr.detectChanges();
    await this.openCamera('eq-mobile-reader', () => this.mobileScanBox?.nativeElement);
  }

  async setMobileScanBy(mode: 'pda' | 'camera'): Promise<void> {
    if (mode === 'pda') {
      this.mobileScanBy = 'pda';
      await this.stopScan();
      this.cdr.markForCheck();
      this.focusMobileScan();
      return;
    }
    if (this.mobileScanBy === 'camera' && this.scanOn) return;
    await this.startMobileScan();
  }

  mobileNext(): void {
    this.dialogOpen = false;
    this.mobileStep = 'equip';
    this.message = '';
    this.resumeMobileScan();
  }

  cancelMobileInspect(): void {
    this.dialogOpen = false;
    this.mobileStep = 'equip';
    this.resumeMobileScan();
  }

  @HostListener('document:keydown', ['$event'])
  onPdaKey(event: KeyboardEvent): void {
    if (!this.mobileUi || this.mobileScanBy !== 'pda') return;
    if (this.mobileStep !== 'staff' && this.mobileStep !== 'equip') return;
    const el = this.mobileScanBox?.nativeElement;
    if (!el || document.activeElement === el) return;
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      this.submitScan();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.scanBuffer += event.key;
      this.cdr.markForCheck();
    }
  }

  private resumeMobileScan(): void {
    if (this.mobileScanBy === 'camera') void this.startMobileScan();
    else {
      void this.stopScan();
      this.focusMobileScan();
      this.cdr.markForCheck();
    }
  }

  private async openCamera(elementId: string, focus: () => HTMLInputElement | undefined): Promise<void> {
    await this.stopScan();
    this.scanError = '';
    this.scanOn = true;
    this.cdr.detectChanges();
    try {
      const mod = await import('html5-qrcode');
      const Html5Qrcode = (mod as { Html5Qrcode: new (id: string) => {
        start: (cam: { facingMode: string }, cfg: { fps: number }, ok: (text: string) => void, err: () => void) => Promise<null>;
        stop: () => Promise<void>;
      } }).Html5Qrcode;
      const scanner = new Html5Qrcode(elementId);
      this.scanner = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 8 },
        (text) => { void this.onScanned(text); },
        () => undefined
      );
      focus()?.focus();
    } catch (e: unknown) {
      this.scanError = e instanceof Error ? e.message : 'Không mở được camera. Vẫn quét được bằng máy scan.';
      this.scanOn = false;
      focus()?.focus();
    }
    this.cdr.markForCheck();
  }

  async stopScan(): Promise<void> {
    this.scanOn = false;
    if (this.scanner) {
      try { await this.scanner.stop(); } catch { /* already stopped */ }
      this.scanner = null;
    }
  }

  submitScan(): void {
    const text = this.scanBuffer;
    this.scanBuffer = '';
    void this.onScanned(text);
  }

  async onScanned(raw: string): Promise<void> {
    if (this.mobileUi) {
      await this.onMobileScanned(raw);
      return;
    }
    const code = raw.trim().replace(/^EQ:/i, '');
    if (!code || this.scanLock) return;
    const eq = this.equipment.find(e => e.managementCode.toLowerCase() === code.toLowerCase() || e.equipmentId.toLowerCase() === code.toLowerCase());
    if (!eq) {
      this.flash(`Không thấy thiết bị ${code}.`, true);
      this.scanBox?.nativeElement.focus();
      return;
    }
    this.scanLock = true;
    try {
      await this.stopScan();
      this.view = 'check';
      const now = new Date();
      this.year = now.getFullYear();
      this.month = now.getMonth() + 1;
      this.selectedDay = now.getDate();
      await this.reload();
      const fresh = this.equipment.find(item => item.equipmentId === eq.equipmentId) || eq;
      await this.openDay(fresh, this.selectedDay);
    } finally {
      this.scanLock = false;
      this.cdr.markForCheck();
    }
  }

  async sendZalo(): Promise<void> {
    this.zaloSending = true;
    this.cdr.markForCheck();
    try {
      const callable = this.fns.httpsCallable<Record<string, never>, { sent: number; due: number; offDay: boolean }>('sendEquipmentChecklistZaloRemindFn');
      const data = await firstValueFrom(callable({}));
      if (data?.offDay) this.flash('Chủ nhật hoặc ngày lễ, không nhắc kiểm tra.');
      else if (!data?.due) this.flash('Đã kiểm tra đủ trước 11:00. Không nhắn nhóm Kho.');
      else if (data.sent) this.flash(`Đã nhắn nhóm Kho ${data.due} thiết bị chưa kiểm tra.`);
      else this.flash('Không gửi được tin vào nhóm Kho.', true);
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message || 'Gửi nhắc Zalo thất bại. Hàm nhắc cần được triển khai trên Firebase.';
      this.flash(msg, true);
    } finally {
      this.zaloSending = false;
      this.cdr.markForCheck();
    }
  }

  trackEq(_i: number, eq: Equipment): string {
    return eq.equipmentId;
  }

  private async onMobileScanned(raw: string): Promise<void> {
    const code = raw.trim();
    if (!code || this.scanLock || this.mobileStep === 'form' || this.mobileStep === 'done') return;
    this.scanBuffer = '';
    if (this.mobileStep === 'staff') {
      const person = this.findStaff(code);
      if (!person) {
        this.flash('Không thấy mã nhân viên.', true);
        this.focusMobileScan();
        return;
      }
      this.mobileStaff = person;
      this.mobileStep = 'equip';
      this.message = '';
      this.holdScan();
      this.cdr.markForCheck();
      return;
    }
    const id = code.replace(/^EQ:/i, '');
    if (this.findStaff(id)) return;
    const eq = this.equipment.find(e => e.managementCode.toLowerCase() === id.toLowerCase() || e.equipmentId.toLowerCase() === id.toLowerCase());
    if (!eq) {
      this.flash(`Không thấy thiết bị ${id}.`, true);
      this.focusMobileScan();
      return;
    }
    this.scanLock = true;
    try {
      await this.stopScan();
      const now = new Date();
      this.year = now.getFullYear();
      this.month = now.getMonth() + 1;
      this.selectedDay = now.getDate();
      await this.reload();
      const fresh = this.equipment.find(item => item.equipmentId === eq.equipmentId) || eq;
      await this.openDay(fresh, this.selectedDay);
      this.dialogInspector = this.mobileStaff?.name || this.mobileStaff?.employeeId || this.dialogInspector;
      this.dialogOpen = false;
      this.mobileStep = 'form';
      this.message = '';
    } finally {
      this.scanLock = false;
      this.cdr.markForCheck();
    }
  }

  private findStaff(raw: string): EquipmentStaff | null {
    const code = raw.trim().split(/\s+/)[0].toUpperCase();
    return this.staff.find(person => person.employeeId.trim().toUpperCase() === code) || null;
  }

  private holdScan(ms = 1500): void {
    this.scanLock = true;
    window.setTimeout(() => {
      this.scanLock = false;
      this.focusMobileScan();
    }, ms);
  }

  private focusMobileScan(): void {
    window.setTimeout(() => this.mobileScanBox?.nativeElement.focus(), 50);
  }

  private namesFor(eq: Equipment): string[] {
    if (eq.inspectionItems?.length) return eq.inspectionItems.filter(Boolean);
    const sub = this.checklistGroups.flatMap(group => group.subs).find(row => row.id === eq.subcategoryId);
    const items = sub?.items.map(item => item.trim()).filter(Boolean);
    if (items?.length) return items;
    return checklistNames(eq);
  }

  private applyCatalog(checklists: Record<string, string[]>, maintenanceItems: string[]): void {
    this.checklistGroups = SEED_CATEGORIES.map(cat => ({
      name: cat.name,
      subs: cat.subcategories.map(sub => ({
        id: sub.id,
        name: sub.name,
        items: (checklists[sub.id]?.length ? checklists[sub.id] : sub.inspectionItems).slice()
      }))
    }));
    this.maintenanceItems = maintenanceItems.slice();
  }

  private isHandheld(): boolean {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  }

  private canInspectDate(iso: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) && iso <= this.todayKey();
  }

  private selectedDate(): string {
    const max = daysOfMonth(this.year, this.month).length;
    const day = Math.min(this.selectedDay, max);
    return dateKey(this.year, this.month, day);
  }

  private todayKey(): string {
    const n = new Date();
    return dateKey(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }

  private periodResult(eq: Equipment, day: string): InspectionResult {
    const mine = this.records.filter(r => r.equipmentId === eq.equipmentId && isClosed(r.result));
    if (eq.frequency === 'daily') return mine.find(r => r.inspectionDate === day)?.result || 'NOT_CHECKED';
    const inPeriod = mine.filter(r => {
      if (eq.frequency === 'monthly') return r.inspectionDate.slice(0, 7) === day.slice(0, 7);
      return periodDone({ ...eq, frequency: 'weekly' }, [r], day);
    });
    if (inPeriod.some(r => r.result === 'FAIL')) return 'FAIL';
    if (inPeriod.some(r => r.result === 'PASS')) return 'PASS';
    return inPeriod[0]?.result || 'NOT_CHECKED';
  }

  private async ensureLabelImages(ids: string[]): Promise<void> {
    for (const id of ids) {
      if (this.labelImages.has(id)) continue;
      const url = await QRCode.toDataURL(`EQ:${id}`, { width: 240, margin: 1 });
      this.labelImages.set(id, url);
    }
    this.cdr.markForCheck();
  }

  private emptyEquipment(): Equipment {
    return {
      equipmentId: '',
      stt: this.equipment.length + 1,
      categoryId: 'CAT-01',
      subcategoryId: 'CAT-01-01',
      equipmentName: '',
      managementCode: '',
      responsiblePerson: null,
      responsibleEmployeeId: null,
      frequency: 'daily' as InspectionFrequency,
      status: 'ACTIVE',
      checkBy: 'computer'
    };
  }

  private initCollapse(): void {
    if (this.collapseReady || !this.equipment.length) return;
    this.collapseReady = true;
    SEED_CATEGORIES.forEach((cat, gi) => {
      if (gi > 0) this.collapsed.add('c:' + cat.id);
      cat.subcategories.forEach((sub, si) => {
        if (!(gi === 0 && si === 0)) this.collapsed.add('s:' + sub.id);
      });
    });
  }

  private flash(text: string, error = false): void {
    this.message = text;
    this.messageError = error;
    this.cdr.markForCheck();
  }
}

function pct(part: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((part / total) * 1000) / 10}%`;
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được ảnh.'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 800 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}
