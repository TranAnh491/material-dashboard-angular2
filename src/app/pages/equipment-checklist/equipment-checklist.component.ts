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
  /** Mật khẩu mở mục Danh sách thiết bị (chỉ chặn trên giao diện, giống mật khẩu Xóa). */
  private static readonly LIST_PASSWORD = '2026';
  showListPassword = false;
  listPassword = '';
  listPasswordError = '';
  private listUnlocked = false;
  deleteError = '';
  deleting = false;
  showInspect = false;
  showMaintenanceForm = false;
  maintenanceDoneKeys = new Set<string>();
  readonly maintenanceGroups: Array<{ by: 'internal' | 'external'; title: string }> = [
    { by: 'internal', title: 'Bảo dưỡng trong' },
    { by: 'external', title: 'Bảo dưỡng ngoài' }
  ];

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
  maintBoxes: Array<{ iso: string; internal: number; external: number; late: boolean }> = [];
  maintKpi = { internal: 0, external: 0, internalSoon: 0, externalSoon: 0, internalLate: 0, externalLate: 0 };

  historyEquipment: Equipment | null = null;
  history: InspectionRecord[] = [];

  labelSelection = new Set<string>();
  labelImages = new Map<string, string>();

  scanOn = false;
  scanError = '';
  mobileUi = false;
  mobileStep: 'staff' | 'equip' | 'late' | 'form' | 'done' = 'equip';
  mobileLateEquipment: Equipment | null = null;
  mobileLateDates: string[] = [];
  mobileScanBy: 'pda' | 'camera' = 'pda';
  mobileStaff: EquipmentStaff | null = null;
  private pdaDropUntilBreak = false;
  private pdaDropTimer = 0;
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
    try {
      const filled = await this.api.fillPassedChecksUntil(this.equipment, '2026-10-10', (eq) => ({
        inspector: eq.responsiblePerson?.trim() || this.staff[0]?.name || 'Nguyễn Hoàng Tuấn',
        items: this.namesFor(eq)
      }));
      if (filled > 0) {
        this.flash(`Đã ghi ${filled} lần kiểm tra Đạt đến 10/10/2026.`);
        await this.reload();
      }
    } catch (e: unknown) {
      this.flash(e instanceof Error ? e.message : 'Không ghi được dữ liệu kiểm tra Đạt.', true);
    }
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
      const [equipment, records, staff, catalog, maintenanceDone] = await Promise.all([
        this.api.listEquipment(),
        this.api.listInspections(this.year, this.month),
        this.api.listStaff(),
        this.api.loadItemCatalog(),
        this.api.listMaintenanceDone(this.year)
      ]);
      this.equipment = equipment;
      this.records = records;
      this.staff = staff;
      this.maintenanceDoneKeys = new Set(maintenanceDone.map(row => this.maintenanceDoneKey(row.equipmentId, row.dueDate)));
      this.applyCatalog(catalog.checklists, catalog.maintenanceItems);
      this.initCollapse();
      const max = daysOfMonth(this.year, this.month).length;
      if (this.selectedDay > max) this.selectedDay = max;
      this.refreshMaintenanceBoard();
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

  printChecklistA3(download: boolean): void {
    const logo = `${window.location.origin}/assets/img/logo.png`;
    const days = this.days;
    const issued = '01/10/2026';
    const headDays = days.map(d => `<th class="${this.isSundayDay(d) ? 'sun' : ''}">${d}</th>`).join('');
    const body = this.equipment.map((eq, i) => {
      const cells = days.map(d => {
        if (this.isCellLocked(eq, d)) return '<td class="sun"></td>';
        const tone = this.dayTone(eq, d);
        const mark = tone === 'pass' ? '✓' : tone === 'fail' ? '✕' : '';
        return `<td class="${tone}">${mark}</td>`;
      }).join('');
      return `<tr><td>${i + 1}</td><td class="name">${this.escapePrint(eq.equipmentName)}</td><td>${this.escapePrint(eq.managementCode)}</td><td>${this.escapePrint(eq.responsiblePerson || '')}</td>${cells}</tr>`;
    }).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Danh sách kiểm tra thiết bị ${this.month}/${this.year}</title>
<style>
@page { size: A3 landscape; margin: 10mm; }
body { font-family: Arial, sans-serif; color: #000; margin: 0; }
.pxk-top-header { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 8px; }
.pxk-top-header td { vertical-align: middle; border: 1px solid #000; padding: 6px; }
.logo-cell { width: 180px; text-align: center; }
.logo-cell img { max-width: 160px; max-height: 64px; object-fit: contain; }
.title-cell { text-align: center; }
.title-line1 { font-size: 18px; font-weight: 700; }
.title-line2 { font-size: 14px; font-weight: 700; text-transform: uppercase; margin-top: 4px; }
.meta-cell { width: 220px; }
.meta-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.meta-table td { border: 1px solid #000; padding: 3px 6px; }
.meta-label { width: 46%; background: #f5f5f5; font-weight: 700; }
.sub { margin: 0 0 8px; font-size: 12px; }
table.grid { width: 100%; border-collapse: collapse; font-size: 9px; }
table.grid th, table.grid td { border: 1px solid #000; padding: 2px; text-align: center; }
table.grid th { background: #f0f0f0; }
table.grid td.name { text-align: left; white-space: nowrap; }
td.pass { background: #bbf7d0; color: #166534; font-weight: 700; }
td.fail { background: #fecaca; color: #991b1b; font-weight: 700; }
td.open { background: #fef08a; }
td.sun, th.sun { background: #e5e7eb; }
.legend { margin-top: 8px; font-size: 11px; }
.legend i { display: inline-block; width: 12px; height: 12px; margin: 0 4px 0 10px; vertical-align: -2px; border: 1px solid #000; }
.legend .g { background: #bbf7d0; } .legend .r { background: #fecaca; } .legend .y { background: #fef08a; }
.actions { margin: 10px 0; }
button { height: 32px; padding: 0 12px; font-weight: 700; cursor: pointer; }
@media print { .actions { display: none; } }
</style></head><body>
<div class="actions"><button type="button" onclick="window.print()">In A3</button></div>
<table class="pxk-top-header"><tr>
<td class="logo-cell"><img src="${logo}" alt="AIRSPEED"></td>
<td class="title-cell">
  <div class="title-line1">AIRSPEED MANUFACTURING VIET NAM</div>
  <div class="title-line2">DANH SÁCH KIỂM TRA THIẾT BỊ KHO</div>
</td>
<td class="meta-cell"><table class="meta-table">
  <tr><td class="meta-label">Mã quản lý</td><td>WH-WI0030/F01</td></tr>
  <tr><td class="meta-label">Phiên bản</td><td>05</td></tr>
  <tr><td class="meta-label">Ngày ban hành</td><td>${issued}</td></tr>
  <tr><td class="meta-label">Số trang</td><td>1/1</td></tr>
</table></td>
</tr></table>
<p class="sub">Tháng ${this.month}/${this.year}. ✓ Đạt (xanh), chưa làm (vàng), ✕ Không đạt (đỏ). Chủ nhật không kiểm tra. Lịch tuần chỉ thứ 2.</p>
<table class="grid"><thead><tr><th>STT</th><th>Tên thiết bị</th><th>Mã số quản lý</th><th>Người phụ trách</th>${headDays}</tr></thead><tbody>${body}</tbody></table>
<p class="legend"><i class="g"></i>Đạt<i class="y"></i>Chưa làm<i class="r"></i>Không đạt</p>
</body></html>`;
    if (download) {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `danh-sach-kiem-tra-${this.year}-${String(this.month).padStart(2, '0')}.html`;
      a.click();
      URL.revokeObjectURL(a.href);
      return;
    }
    const win = window.open('', '_blank');
    if (!win) {
      this.flash('Trình duyệt đang chặn cửa sổ in.', true);
      return;
    }
    win.document.write(html);
    win.document.close();
  }

  openMaintenanceForm(): void {
    this.showInspect = false;
    this.showMaintenanceForm = true;
    this.cdr.markForCheck();
  }

  closeMaintenanceForm(): void {
    this.showMaintenanceForm = false;
    this.cdr.markForCheck();
  }

  maintenanceEquipment(by: 'internal' | 'external'): Equipment[] {
    return this.equipment.filter(eq =>
      eq.maintenanceBy === by
      && !!eq.maintenanceCycle
      && eq.status !== 'DISPOSED'
      && eq.status !== 'INACTIVE'
    );
  }

  maintenanceRounds(eq: Equipment): string[] {
    return this.maintenanceDatesInYear(eq, this.year);
  }

  maintenanceCycleLabel(eq: Equipment): string {
    if (eq.maintenanceCycle === 'month') return '1 tháng';
    if (eq.maintenanceCycle === 'quarter') return '3 tháng';
    if (eq.maintenanceCycle === 'half') return 'Theo 6 tháng';
    if (eq.maintenanceCycle === 'year') return 'Theo 1 năm';
    if (eq.maintenanceCycle === 'custom') {
      const days = Math.floor(Number(eq.maintenanceRepeatDays) || 0);
      return days > 0 ? `${days} ngày` : 'Tùy chọn';
    }
    return '';
  }

  maintenanceDoneHas(eq: Equipment, iso: string): boolean {
    return this.maintenanceDoneKeys.has(this.maintenanceDoneKey(eq.equipmentId, iso));
  }

  async toggleMaintenanceDone(eq: Equipment, iso: string): Promise<void> {
    const key = this.maintenanceDoneKey(eq.equipmentId, iso);
    const done = !this.maintenanceDoneKeys.has(key);
    const next = new Set(this.maintenanceDoneKeys);
    if (done) next.add(key);
    else next.delete(key);
    this.maintenanceDoneKeys = next;
    this.cdr.markForCheck();
    try {
      await this.api.setMaintenanceDone(eq.equipmentId, iso, done);
    } catch (e: unknown) {
      const rollback = new Set(this.maintenanceDoneKeys);
      if (done) rollback.delete(key);
      else rollback.add(key);
      this.maintenanceDoneKeys = rollback;
      this.flash(e instanceof Error ? e.message : 'Không lưu được lần bảo dưỡng.', true);
      this.cdr.markForCheck();
    }
  }

  printMaintenanceForm(download: boolean): void {
    const logo = `${window.location.origin}/assets/img/logo.png`;
    const section = (title: string, by: 'internal' | 'external') => {
      const rows = this.maintenanceEquipment(by).map((eq, i) => {
        const ticks = this.maintenanceRounds(eq).map(iso => {
          const mark = this.maintenanceDoneHas(eq, iso) ? '☑' : '☐';
          return `${mark} ${this.formatViDate(iso)}`;
        }).join(' &nbsp; ');
        return `<tr><td>${i + 1}</td><td class="name">${this.escapePrint(eq.equipmentName)}</td><td>${this.escapePrint(eq.managementCode)}</td><td>${this.escapePrint(this.maintenanceCycleLabel(eq))}</td><td class="ticks">${ticks || 'Chưa có lịch trong năm'}</td></tr>`;
      }).join('');
      const body = rows || '<tr><td colspan="5">Chưa có thiết bị.</td></tr>';
      return `<h2>${title}</h2><table class="grid"><thead><tr><th>STT</th><th>Tên thiết bị</th><th>Mã số quản lý</th><th>Chu kỳ</th><th>Các lần bảo dưỡng</th></tr></thead><tbody>${body}</tbody></table>`;
    };
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bảo dưỡng định kỳ ${this.year}</title>
<style>
@page { size: A3 landscape; margin: 10mm; }
body { font-family: Arial, sans-serif; color: #000; margin: 0; }
.pxk-top-header { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 8px; }
.pxk-top-header td { vertical-align: middle; border: 1px solid #000; padding: 6px; }
.logo-cell { width: 180px; text-align: center; }
.logo-cell img { max-width: 160px; max-height: 64px; object-fit: contain; }
.title-cell { text-align: center; }
.title-line1 { font-size: 18px; font-weight: 700; }
.title-line2 { font-size: 14px; font-weight: 700; text-transform: uppercase; margin-top: 4px; }
.meta-cell { width: 220px; }
.meta-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.meta-table td { border: 1px solid #000; padding: 3px 6px; }
.meta-label { width: 46%; background: #f5f5f5; font-weight: 700; }
h2 { font-size: 13px; margin: 12px 0 6px; }
table.grid { width: 100%; border-collapse: collapse; font-size: 11px; }
table.grid th, table.grid td { border: 1px solid #000; padding: 4px; text-align: center; }
table.grid th { background: #f0f0f0; }
table.grid td.name, table.grid td.ticks { text-align: left; }
.sub { margin: 0 0 8px; font-size: 12px; }
.actions { margin: 10px 0; }
button { height: 32px; padding: 0 12px; font-weight: 700; cursor: pointer; }
@media print { .actions { display: none; } }
</style></head><body>
<div class="actions"><button type="button" onclick="window.print()">In A3</button></div>
<table class="pxk-top-header"><tr>
<td class="logo-cell"><img src="${logo}" alt="AIRSPEED"></td>
<td class="title-cell">
  <div class="title-line1">AIRSPEED MANUFACTURING VIET NAM</div>
  <div class="title-line2">BẢO DƯỠNG ĐỊNH KỲ</div>
</td>
<td class="meta-cell"><table class="meta-table">
  <tr><td class="meta-label">Mã quản lý</td><td>WH-WI0030/F02</td></tr>
  <tr><td class="meta-label">Phiên bản</td><td>04</td></tr>
  <tr><td class="meta-label">Ngày ban hành</td><td>01/10/2026</td></tr>
  <tr><td class="meta-label">Số trang</td><td>1/1</td></tr>
</table></td>
</tr></table>
<p class="sub">Năm ${this.year}. ☑ đã bảo dưỡng lần đó. ☐ chưa bảo dưỡng.</p>
${section('Bảo dưỡng trong', 'internal')}
${section('Bảo dưỡng ngoài', 'external')}
</body></html>`;
    if (download) {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `bao-duong-dinh-ky-${this.year}.html`;
      a.click();
      URL.revokeObjectURL(a.href);
      return;
    }
    const win = window.open('', '_blank');
    if (!win) {
      this.flash('Trình duyệt đang chặn cửa sổ in.', true);
      return;
    }
    win.document.write(html);
    win.document.close();
  }

  private maintenanceDoneKey(equipmentId: string, iso: string): string {
    return `${equipmentId}|${iso}`;
  }

  private escapePrint(value: string): string {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async openDay(eq: Equipment, day: number): Promise<boolean> {
    const date = dateKey(this.year, this.month, day);
    if (!this.canInspectDate(date, eq)) {
      this.flash(this.inspectBlockReason(date, eq), true);
      return false;
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
    return true;
  }

  async onPanelDate(): Promise<void> {
    if (!this.dialogEquipment || !/^\d{4}-\d{2}-\d{2}$/.test(this.dialogDate)) return;
    if (!this.canInspectDate(this.dialogDate, this.dialogEquipment)) {
      this.flash(this.inspectBlockReason(this.dialogDate, this.dialogEquipment), true);
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
    if (!this.canInspectDate(this.dialogDate, this.dialogEquipment)) {
      this.flash(this.inspectBlockReason(this.dialogDate, this.dialogEquipment), true);
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
      await this.reload();
      this.dialogOpen = false;
      if (this.mobileUi) {
        const rest = this.dialogEquipment ? this.lateDatesFor(this.dialogEquipment) : [];
        this.message = '';
        if (rest.length && this.dialogEquipment) {
          this.mobileLateEquipment = this.dialogEquipment;
          this.mobileLateDates = rest;
          this.mobileStep = 'late';
          return;
        }
        this.mobileStep = 'done';
        return;
      }
      this.flash('Đã lưu kiểm tra.');
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
    if (view === 'list' && !this.listUnlocked) {
      this.listPassword = '';
      this.listPasswordError = '';
      this.showListPassword = true;
      this.cdr.markForCheck();
      return;
    }
    this.view = view;
    this.cdr.markForCheck();
  }

  /** Mở mục Danh sách thiết bị: cần mật khẩu, nhập đúng 1 lần thì mở được tới khi rời tab. */
  confirmListPassword(): void {
    if (this.listPassword !== EquipmentChecklistComponent.LIST_PASSWORD) {
      this.listPasswordError = 'Sai mật khẩu.';
      this.cdr.markForCheck();
      return;
    }
    this.listUnlocked = true;
    this.showListPassword = false;
    this.listPassword = '';
    this.setView('list');
  }

  cancelListPassword(): void {
    this.showListPassword = false;
    this.listPassword = '';
    this.listPasswordError = '';
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

  get monthBars(): Array<{ day: number; pass: number; fail: number; na: number; open: number; sunday: boolean }> {
    const today = this.todayKey();
    return this.days.map(day => {
      const key = dateKey(this.year, this.month, day);
      if (this.isSundayDate(key) || this.isHolidayDate(key)) return { day, pass: 0, fail: 0, na: 0, open: 0, sunday: true };
      let pass = 0;
      let fail = 0;
      let na = 0;
      let open = 0;
      const future = key > today;
      this.activePool.forEach(eq => {
        if (!this.isChartDue(eq, key)) return;
        const result = future ? this.resultOn(eq, key) : this.periodResult(eq, key);
        if (result === 'PASS') pass += 1;
        else if (result === 'FAIL') fail += 1;
        else if (result === 'NA') na += 1;
        else if (!future) open += 1;
      });
      return { day, pass, fail, na, open, sunday: false };
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
    await this.saveRow(eq);
    this.refreshMaintenanceBoard();
    this.cdr.markForCheck();
  }

  async setMaintenanceCycle(eq: Equipment, value: string): Promise<void> {
    const allowed: MaintenanceCycle[] = ['month', 'quarter', 'half', 'year', 'custom'];
    eq.maintenanceCycle = allowed.includes(value as MaintenanceCycle) ? value as MaintenanceCycle : null;
    await this.saveRow(eq);
    this.refreshMaintenanceBoard();
    this.cdr.markForCheck();
  }

  async setMaintenanceStart(eq: Equipment, value: string): Promise<void> {
    eq.maintenanceStartDate = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
    await this.saveRow(eq);
    this.refreshMaintenanceBoard();
    this.cdr.markForCheck();
  }

  async setMaintenanceRepeat(eq: Equipment, value: string | number): Promise<void> {
    const n = Math.floor(Number(value));
    eq.maintenanceRepeatDays = n > 0 ? n : null;
    await this.saveRow(eq);
    this.refreshMaintenanceBoard();
    this.cdr.markForCheck();
  }

  countStatus(status: Equipment['status']): number {
    return this.equipment.filter(eq => eq.status === status).length;
  }

  countMaintenance(by: 'internal' | 'external'): number {
    return this.equipment.filter(eq => eq.maintenanceBy === by).length;
  }

  countCheckBy(by: 'computer' | 'qr'): number {
    return this.equipment.filter(eq => (eq.checkBy || 'computer') === by).length;
  }

  get maintWindowLabel(): string {
    if (!this.maintBoxes.length) return '';
    const first = this.maintBoxes[0].iso;
    const last = this.maintBoxes[this.maintBoxes.length - 1].iso;
    return `${this.formatViMonth(first)} – ${this.formatViMonth(last)}`;
  }

  get maintMonths(): Array<{ label: string; boxes: Array<{ iso: string; internal: number; external: number; late: boolean }> }> {
    const groups: Array<{ label: string; boxes: typeof this.maintBoxes }> = [];
    let key = '';
    this.maintBoxes.forEach(box => {
      const monthKey = box.iso.slice(0, 7);
      if (monthKey !== key) {
        key = monthKey;
        groups.push({ label: this.formatViMonth(box.iso), boxes: [] });
      }
      groups[groups.length - 1].boxes.push(box);
    });
    return groups;
  }

  yearBoxTitle(box: { iso: string; internal: number; external: number }): string {
    const [y, m, d] = box.iso.split('-');
    const parts = [`${d}/${m}/${y}`];
    if (box.internal) parts.push(`Trong: ${box.internal}`);
    if (box.external) parts.push(`Ngoài: ${box.external}`);
    if (!box.internal && !box.external) parts.push('Không tới hạn');
    return parts.join(' · ');
  }

  private formatViMonth(iso: string): string {
    const [y, m] = iso.split('-');
    return `${m}/${y}`;
  }

  private refreshMaintenanceBoard(): void {
    const today = this.todayKey();
    const soon = this.shiftIso(today, 30);
    const kpi = { internal: 0, external: 0, internalSoon: 0, externalSoon: 0, internalLate: 0, externalLate: 0 };
    const [y, m] = today.split('-').map(Number);
    const start = new Date(y, (m || 1) - 1, 1);
    const end = new Date(y, (m || 1) - 1 + 12, 0);
    const fromIso = this.isoDate(start);
    const toIso = this.isoDate(end);
    const boxes: Array<{ iso: string; internal: number; external: number; late: boolean }> = [];
    const cursor = new Date(start);
    while (this.isoDate(cursor) <= toIso) {
      const iso = this.isoDate(cursor);
      boxes.push({ iso, internal: 0, external: 0, late: iso < today });
      cursor.setDate(cursor.getDate() + 1);
    }
    const index = new Map(boxes.map((box, i) => [box.iso, i]));
    for (const eq of this.equipment) {
      if (eq.maintenanceBy !== 'internal' && eq.maintenanceBy !== 'external') continue;
      if (!eq.maintenanceCycle) continue;
      if (eq.maintenanceBy === 'internal') kpi.internal += 1;
      else kpi.external += 1;
      const next = this.nextMaintenanceIso(eq, today);
      if (next) {
        const late = next < today;
        const upcoming = next >= today && next <= soon;
        if (eq.maintenanceBy === 'internal') {
          if (late) kpi.internalLate += 1;
          else if (upcoming) kpi.internalSoon += 1;
        } else if (late) kpi.externalLate += 1;
        else if (upcoming) kpi.externalSoon += 1;
      }
      for (const iso of this.maintenanceDatesBetween(eq, fromIso, toIso)) {
        const at = index.get(iso);
        if (at === undefined) continue;
        if (eq.maintenanceBy === 'internal') boxes[at].internal += 1;
        else boxes[at].external += 1;
      }
    }
    this.maintBoxes = boxes;
    this.maintKpi = kpi;
  }

  private nextMaintenanceIso(eq: Equipment, today: string): string | null {
    const first = this.firstMaintenanceDate(eq);
    if (!first) return null;
    let cursor = first;
    let last: string | null = null;
    for (let i = 0; i < 500; i++) {
      const iso = this.isoDate(cursor);
      if (iso >= today) return iso;
      last = iso;
      const next = this.advanceMaintenance(eq, cursor);
      if (!next || this.isoDate(next) === iso) return last;
      cursor = next;
    }
    return last;
  }

  private maintenanceDatesInYear(eq: Equipment, year: number): string[] {
    return this.maintenanceDatesBetween(eq, `${year}-01-01`, `${year}-12-31`);
  }

  private firstMaintenanceDate(eq: Equipment): Date | null {
    const anchor = this.maintenanceAnchor(eq);
    if (!anchor) return null;
    return this.advanceMaintenance(eq, anchor);
  }

  private maintenanceDatesBetween(eq: Equipment, fromIso: string, toIso: string): string[] {
    const first = this.firstMaintenanceDate(eq);
    if (!first) return [];
    let cursor = first;
    const out: string[] = [];
    for (let i = 0; i < 500 && this.isoDate(cursor) < fromIso; i++) {
      const next = this.advanceMaintenance(eq, cursor);
      if (!next) return out;
      cursor = next;
    }
    for (let i = 0; i < 400; i++) {
      const iso = this.isoDate(cursor);
      if (iso > toIso) break;
      if (iso >= fromIso) out.push(iso);
      const next = this.advanceMaintenance(eq, cursor);
      if (!next || this.isoDate(next) <= iso) break;
      cursor = next;
    }
    return out;
  }

  private maintenanceAnchor(eq: Equipment): Date | null {
    const raw = String(eq.maintenanceStartDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const [y, m, d] = raw.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  private advanceMaintenance(eq: Equipment, from: Date): Date | null {
    if (eq.maintenanceCycle === 'month') return new Date(from.getFullYear(), from.getMonth() + 1, from.getDate());
    if (eq.maintenanceCycle === 'quarter') return new Date(from.getFullYear(), from.getMonth() + 3, from.getDate());
    if (eq.maintenanceCycle === 'half') return new Date(from.getFullYear(), from.getMonth() + 6, from.getDate());
    if (eq.maintenanceCycle === 'year') return new Date(from.getFullYear() + 1, from.getMonth(), from.getDate());
    const days = Math.floor(Number(eq.maintenanceRepeatDays) || 0);
    if (eq.maintenanceCycle === 'custom' && days > 0) return new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
    return null;
  }

  private isoDate(d: Date): string {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  private shiftIso(iso: string, days: number): string {
    const [y, m, d] = iso.split('-').map(Number);
    return this.isoDate(new Date(y, m - 1, d + days));
  }

  dayTone(eq: Equipment, day: number): '' | 'pass' | 'fail' | 'open' {
    if (this.isCellLocked(eq, day)) return '';
    const iso = this.cellDate(day);
    const result = this.resultOn(eq, iso);
    if (result === 'PASS') return 'pass';
    if (result === 'FAIL') return 'fail';
    if (result === 'NA') return '';
    if (iso > this.todayKey()) return '';
    return 'open';
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

  isSundayDay(day: number): boolean {
    return this.isSundayDate(this.cellDate(day));
  }

  isWeeklyLockedDay(eq: Equipment, day: number): boolean {
    return eq.frequency === 'weekly' && !this.isMondayDate(this.cellDate(day));
  }

  isCellLocked(eq: Equipment, day: number): boolean {
    return this.isSundayDay(day) || this.isWeeklyLockedDay(eq, day);
  }

  weekdayLabel(day: number): string {
    const [y, m, d] = this.cellDate(day).split('-').map(Number);
    return ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(y, m - 1, d).getDay()];
  }

  canInspectDay(day: number, eq?: Equipment): boolean {
    return this.canInspectDate(this.cellDate(day), eq);
  }

  dayLockTitle(day: number, eq?: Equipment): string {
    if (this.isSundayDay(day)) return 'Chủ nhật không kiểm tra.';
    if (eq && this.isWeeklyLockedDay(eq, day)) return 'Lịch tuần: chỉ kiểm vào thứ 2.';
    if (!this.canInspectDay(day, eq)) return 'Không kiểm tra trước ngày.';
    if (eq && this.checkedDay(eq, day)) return 'Đã kiểm';
    return eq ? 'Tick để kiểm tra' : 'Chưa kiểm';
  }

  openInspectDay(eq: Equipment, day: number): void {
    if (this.isQrCheck(eq)) return;
    if (!this.canInspectDay(day, eq)) {
      this.flash(this.inspectBlockReason(this.cellDate(day), eq), true);
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

  itemTitle(name: string): string {
    if (!this.showsPalletItemDetail()) return name;
    return this.itemCopy(name).title;
  }

  itemDetail(name: string): string {
    if (!this.showsPalletItemDetail()) return '';
    return this.itemCopy(name).detail;
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

  goBack(): void {
    if (this.mobileUi && this.mobileStep === 'form' && this.mobileLateEquipment) {
      this.dialogOpen = false;
      this.mobileLateDates = this.lateDatesFor(this.mobileLateEquipment);
      this.mobileStep = this.mobileLateDates.length ? 'late' : 'equip';
      if (this.mobileStep === 'equip') this.resumeMobileScan();
      this.cdr.markForCheck();
      return;
    }
    if (this.mobileUi && this.mobileStep === 'late') {
      this.mobileLateEquipment = null;
      this.mobileLateDates = [];
      this.mobileStep = 'equip';
      this.resumeMobileScan();
      return;
    }
    if (this.mobileUi && (this.mobileStep === 'form' || this.mobileStep === 'done')) {
      this.cancelMobileInspect();
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    void this.router.navigate(['/menu']);
  }

  get pendingForStaff(): Equipment[] {
    const id = this.pdaStaffCode(this.mobileStaff?.employeeId || '');
    const day = this.todayKey();
    return this.equipment.filter(eq => {
      if (eq.status !== 'ACTIVE' && eq.status !== 'REPAIR') return false;
      if (id && this.pdaStaffCode(eq.responsibleEmployeeId || '') !== id) return false;
      if (eq.frequency === 'weekly' && !this.isMondayDate(day)) return false;
      return !periodDone(eq, this.records, day);
    });
  }

  async openPending(eq: Equipment): Promise<void> {
    await this.beginEquipmentCheck(eq);
  }

  async openLateDay(iso: string): Promise<void> {
    const eq = this.mobileLateEquipment;
    if (!eq || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    const [y, m, d] = iso.split('-').map(Number);
    if (y !== this.year || m !== this.month) {
      this.year = y;
      this.month = m;
      await this.reload();
    }
    const fresh = this.equipment.find(item => item.equipmentId === eq.equipmentId) || eq;
    const opened = await this.openDay(fresh, d);
    if (!opened) return;
    this.dialogInspector = this.mobileStaff?.name || this.mobileStaff?.employeeId || this.dialogInspector;
    this.dialogOpen = false;
    this.mobileStep = 'form';
    this.message = '';
    this.cdr.markForCheck();
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

  onMobileScanKey(event: KeyboardEvent): void {
    const enter = event.key === 'Enter' || event.key === 'Tab';
    if (this.pdaDropUntilBreak) {
      event.preventDefault();
      if (enter) this.clearPdaDrop();
      return;
    }
    if (enter) {
      event.preventDefault();
      this.submitScan();
      return;
    }
    if (!this.isPdaStaffScan() || event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    window.setTimeout(() => this.commitPdaStaffIfReady(), 0);
  }

  @HostListener('document:keydown', ['$event'])
  onPdaKey(event: KeyboardEvent): void {
    if (!this.mobileUi || this.mobileScanBy !== 'pda') return;
    if (this.mobileStep !== 'staff' && this.mobileStep !== 'equip') return;
    const el = this.mobileScanBox?.nativeElement;
    if (!el || document.activeElement === el) return;
    const enter = event.key === 'Enter' || event.key === 'Tab';
    if (this.pdaDropUntilBreak) {
      event.preventDefault();
      if (enter) this.clearPdaDrop();
      return;
    }
    if (enter) {
      event.preventDefault();
      this.submitScan();
      return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    if (this.mobileStep === 'staff') {
      const next = this.scanBuffer + event.key;
      const code = this.pdaStaffCode(next);
      if (code) {
        this.scanBuffer = code;
        this.armPdaDrop();
        this.cdr.markForCheck();
        void this.onScanned(code);
        return;
      }
      this.scanBuffer = next;
      this.cdr.markForCheck();
      return;
    }
    this.scanBuffer += event.key;
    this.cdr.markForCheck();
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
    const box = this.mobileUi ? this.mobileScanBox?.nativeElement : undefined;
    let text = box?.value || this.scanBuffer;
    if (this.mobileUi && this.mobileStep === 'staff') text = this.pdaStaffCode(text);
    this.scanBuffer = '';
    if (box) box.value = '';
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
      else if (!data?.due) this.flash('Đã kiểm tra đủ. Không nhắn nhóm Kho.');
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
    const id = code.replace(/^EQ:/i, '');
    const eq = this.equipment.find(e => e.managementCode.toLowerCase() === id.toLowerCase() || e.equipmentId.toLowerCase() === id.toLowerCase());
    if (!eq) {
      this.flash(`Không thấy thiết bị ${id}.`, true);
      this.focusMobileScan();
      return;
    }
    this.scanLock = true;
    try {
      await this.beginEquipmentCheck(eq);
    } finally {
      this.scanLock = false;
      this.cdr.markForCheck();
    }
  }

  private showsPalletItemDetail(): boolean {
    if (this.dialogEquipment?.subcategoryId === 'CAT-01-01') return true;
    const names = new Set(this.itemRows.map(row => row.name.trim().toLowerCase()));
    return names.has('pin') && names.has('thủy lực') && names.has('bánh xe')
      && (names.has('phanh') || names.has('hệ thống thắng'));
  }

  private itemCopy(name: string): { title: string; detail: string } {
    const key = name.trim().toLowerCase();
    const rows: Record<string, { title: string; detail: string }> = {
      'pin': { title: 'Pin', detail: 'Pin có hiển thị % không' },
      'phanh': { title: 'Hệ thống thắng', detail: 'Có dừng khi thả tay lái không' },
      'hệ thống thắng': { title: 'Hệ thống thắng', detail: 'Có dừng khi thả tay lái không' },
      'thủy lực': { title: 'Thủy lực', detail: 'Có nâng hạ không' },
      'bánh xe': { title: 'Bánh xe', detail: 'Hoạt động bình thường không' }
    };
    return rows[key] || { title: name, detail: '' };
  }

  private findStaff(raw: string): EquipmentStaff | null {
    const code = raw.trim().split(/\s+/)[0].toUpperCase();
    const head = this.pdaStaffCode(code);
    return this.staff.find(person => {
      const id = person.employeeId.trim().toUpperCase();
      return id === code || (!!head && (id === head || this.pdaStaffCode(id) === head));
    }) || null;
  }

  private async beginEquipmentCheck(eq: Equipment): Promise<void> {
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth() + 1;
    this.selectedDay = now.getDate();
    await this.stopScan();
    await this.reload();
    const fresh = this.equipment.find(item => item.equipmentId === eq.equipmentId) || eq;
    const late = this.lateDatesFor(fresh);
    if (late.length) {
      this.mobileLateEquipment = fresh;
      this.mobileLateDates = late;
      this.dialogOpen = false;
      this.mobileStep = 'late';
      this.message = '';
      this.cdr.markForCheck();
      return;
    }
    this.mobileLateEquipment = null;
    this.mobileLateDates = [];
    const opened = await this.openDay(fresh, this.selectedDay);
    if (!opened) {
      this.resumeMobileScan();
      return;
    }
    this.dialogInspector = this.mobileStaff?.name || this.mobileStaff?.employeeId || this.dialogInspector;
    this.dialogOpen = false;
    this.mobileStep = 'form';
    this.message = '';
    this.cdr.markForCheck();
  }

  private lateDatesFor(eq: Equipment): string[] {
    if (eq.frequency === 'monthly') return [];
    const today = this.todayKey();
    let cursor = `${today.slice(0, 7)}-01`;
    const end = this.shiftIso(today, -1);
    const out: string[] = [];
    while (cursor <= end && out.length < 31) {
      const required = eq.frequency === 'weekly' ? this.isMondayDate(cursor) : !this.isSundayDate(cursor);
      if (required && !this.isHolidayDate(cursor) && !periodDone(eq, this.records, cursor)) out.push(cursor);
      cursor = this.shiftIso(cursor, 1);
    }
    return out;
  }

  private isHolidayDate(iso: string): boolean {
    const fixed = ['01-01', '04-30', '05-01', '09-02'];
    const extra = new Set(['2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-04-25', '2026-04-27', '2026-09-01']);
    return fixed.includes(iso.slice(5)) || extra.has(iso);
  }

  private isPdaStaffScan(): boolean {
    return this.mobileUi && this.mobileStep === 'staff';
  }

  private pdaStaffCode(raw: string): string {
    const compact = String(raw || '').replace(/[\s\u0000-\u001F]+/g, '').toUpperCase();
    const head = compact.slice(0, 7);
    if (/^ASP\d{4}$/.test(head)) return head;
    return compact.match(/ASP\d{4}/)?.[0] || '';
  }

  private commitPdaStaffIfReady(): void {
    if (!this.isPdaStaffScan() || this.pdaDropUntilBreak || this.scanLock) return;
    const box = this.mobileScanBox?.nativeElement;
    const value = box?.value || this.scanBuffer;
    const code = this.pdaStaffCode(value);
    if (!code) return;
    this.armPdaDrop();
    this.scanBuffer = '';
    if (box) box.value = '';
    void this.onScanned(code);
  }

  private armPdaDrop(): void {
    this.pdaDropUntilBreak = true;
    window.clearTimeout(this.pdaDropTimer);
    this.pdaDropTimer = window.setTimeout(() => this.clearPdaDrop(), 500);
  }

  private clearPdaDrop(): void {
    this.pdaDropUntilBreak = false;
    window.clearTimeout(this.pdaDropTimer);
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

  private canInspectDate(iso: string, eq?: Equipment | null): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso > this.todayKey() || this.isSundayDate(iso)) return false;
    if (eq?.frequency === 'weekly' && !this.isMondayDate(iso)) return false;
    return true;
  }

  private isSundayDate(iso: string): boolean {
    return this.weekdayIndex(iso) === 0;
  }

  private isMondayDate(iso: string): boolean {
    return this.weekdayIndex(iso) === 1;
  }

  private weekdayIndex(iso: string): number {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return -1;
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).getDay();
  }

  private inspectBlockReason(iso: string, eq?: Equipment | null): string {
    if (this.isSundayDate(iso)) return 'Chủ nhật không kiểm tra.';
    if (eq?.frequency === 'weekly' && !this.isMondayDate(iso)) return 'Lịch tuần: chỉ kiểm vào thứ 2.';
    return 'Không kiểm tra trước ngày.';
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

  /** Ngày thực sự phải có kết quả trên chart: tuần chỉ thứ 2, ngày/tháng các ngày làm việc. */
  private isChartDue(eq: Equipment, iso: string): boolean {
    if (eq.frequency === 'weekly') return this.isMondayDate(iso);
    return true;
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
      const url = await QRCode.toDataURL(`EQ:${id}`, { width: 512, margin: 1 });
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
