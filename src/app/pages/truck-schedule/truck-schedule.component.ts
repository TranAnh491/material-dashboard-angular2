import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Router } from '@angular/router';
import firebase from 'firebase/compat/app';
import { Subject, takeUntil } from 'rxjs';
import { FirebaseAuthService, User } from '../../services/firebase-auth.service';

type DepartmentCode =
  | 'WH'
  | 'CS'
  | 'PLN'
  | 'PD'
  | 'FIN'
  | 'LOG'
  | 'BUYER'
  | 'MCD'
  | 'QA'
  | 'ENG'
  | 'HR';

type TruckRequestStatus = 'pending' | 'approved' | 'rejected' | 'rescheduled';

type TruckDeliveryRequest = {
  id: string;
  status: TruckRequestStatus;
  dateYmd: string; // YYYY-MM-DD
  monthKey: number; // YYYYMM
  dayKey: number; // YYYYMMDD

  employeeCode: string;
  employeeName: string;
  department: DepartmentCode;

  deliveryPlace: string;
  pickupPlace: string;
  receiverName: string;
  receiverPhone: string;
  receiverLocationLink?: string;

  createdAt?: Date;
  createdByUid?: string;
  createdByEmail?: string;

  approvedAt?: Date;
  approvedByUid?: string;
  approvedByName?: string;

  // Warehouse note (ghi chú khi xử lý: Từ chối / Đồng ý / Đổi lịch)
  warehouseNote?: string;
};

type CalendarCell = {
  date: Date;
  ymd: string;
  isToday: boolean;
  isSunday: boolean;
  blocked: boolean;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  rescheduledCount: number;
};

type WarehouseCode = 'ASM1' | 'ASM2' | 'ASM3';

type Asm3Scenario = 'return_asm1' | 'to_asm2' | 'pickup_asm2' | 'no_shipment';

type WarehouseStatus = {
  code: WarehouseCode;
  hasGoods: boolean;
  asm3Scenario: Asm3Scenario;
  updatedAt?: Date;
  updatedByName?: string;
};

@Component({
  selector: 'app-truck-schedule',
  templateUrl: './truck-schedule.component.html',
  styleUrls: ['./truck-schedule.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TruckScheduleComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private readonly COLLECTION = 'truck-delivery-requests';
  private readonly BLOCKED_COLLECTION = 'truck-blocked-days';
  private readonly WAREHOUSE_COLLECTION = 'truck-warehouse-status';
  private readonly bodyClass = 'truck-schedule-tab';
  private readonly WAREHOUSE_CODES: WarehouseCode[] = ['ASM1', 'ASM2', 'ASM3'];
  private readonly APPROVE_PASS = '112233';
  private readonly DELETE_PASS = '112233';
  private readonly BLOCK_PASS = '112233';

  currentUser: User | null = null;
  canApprove = false;
  canDelete = false;

  // Calendar state (chỉ 2 tuần: tuần hiện tại + tuần tiếp theo)
  rangeStart = this.getWeekStartMonday(new Date());
  rangeEnd = this.addDays(this.getWeekStartMonday(new Date()), 13);
  calendarWeeks: CalendarCell[][] = [];
  selectedDayYmd = this.toYmd(new Date());

  blockedDayKeys = new Set<number>();

  warehouseStatuses: Record<WarehouseCode, WarehouseStatus> = {
    ASM1: { code: 'ASM1', hasGoods: false, asm3Scenario: 'no_shipment' },
    ASM2: { code: 'ASM2', hasGoods: false, asm3Scenario: 'no_shipment' },
    ASM3: { code: 'ASM3', hasGoods: false, asm3Scenario: 'no_shipment' }
  };
  selectedWarehouse: WarehouseCode | null = null;
  isWarehouseLoading = false;
  isWarehouseSaving = false;
  warehouseError = '';
  warehouseTodayHasData = false;

  readonly asm3ScenarioOptions: Array<{ key: Asm3Scenario; label: string }> = [
    { key: 'return_asm1', label: '2.1 — Có hàng về ASM1' },
    { key: 'to_asm2', label: '2.2 — Có hàng đi ASM2' },
    { key: 'pickup_asm2', label: '2.3 — Lấy hàng ASM2 về ASM1' },
    { key: 'no_shipment', label: '2.4 — Không có hàng' }
  ];

  // Data state
  isLoadingRange = false;
  loadError = '';
  rangeRequests: TruckDeliveryRequest[] = [];
  requestsByDay = new Map<string, TruckDeliveryRequest[]>();

  // Modal state (Register)
  showRegisterModal = false;
  isSubmitting = false;
  submitError = '';

  // Modal state (Approve/Reject/Reschedule)
  showDecisionModal = false;
  decisionTarget: TruckDeliveryRequest | null = null;
  isDecisionProcessing = false;
  showRescheduleInput = false;
  rescheduleDateYmd = '';
  decisionNote = '';
  decisionError = '';

  regEmployeeCode = '';
  regEmployeeName = '';
  regDepartment: DepartmentCode = 'WH';
  regDateYmd = this.toYmd(new Date());
  regDeliveryPlace = '';
  regPickupPlace = '';
  regReceiverName = '';
  regReceiverPhone = '';
  regReceiverLocationLink = '';

  readonly departments: DepartmentCode[] = [
    'WH',
    'CS',
    'PLN',
    'PD',
    'FIN',
    'LOG',
    'BUYER',
    'MCD',
    'QA',
    'ENG',
    'HR'
  ];

  constructor(
    private firestore: AngularFirestore,
    private authService: FirebaseAuthService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    document.body.classList.add(this.bodyClass);
    this.authService.user$.pipe(takeUntil(this.destroy$)).subscribe((u) => {
      this.currentUser = u;
      const dept = String(u?.department || '').trim().toUpperCase();
      const role = String(u?.role || '').trim();
      this.canApprove = dept === 'WH' || role === 'Admin' || role === 'Quản lý';
      this.canDelete = this.canApprove;
      this.cdr.markForCheck();
    });

    void this.loadCurrentRange();
    void this.loadWarehouseStatuses();
  }

  ngOnDestroy(): void {
    document.body.classList.remove(this.bodyClass);
    this.destroy$.next();
    this.destroy$.complete();
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  // ===== Calendar helpers =====
  rangeTitle(): string {
    return `${this.toYmd(this.rangeStart)} → ${this.toYmd(this.rangeEnd)}`;
  }

  refreshRange(): void {
    void this.loadCurrentRange();
    void this.loadWarehouseStatuses();
  }

  get warehouseTodayYmd(): string {
    return this.toYmd(new Date());
  }

  get warehouseTodayDayKey(): number {
    return this.toDayKey(this.warehouseTodayYmd);
  }

  get warehouseList(): WarehouseStatus[] {
    return this.WAREHOUSE_CODES.map((code) => this.warehouseStatuses[code]);
  }

  get activeWarehouseCodes(): WarehouseCode[] {
    return this.WAREHOUSE_CODES.filter((code) => this.warehouseStatuses[code]?.hasGoods);
  }

  selectWarehouse(code: WarehouseCode): void {
    this.selectedWarehouse = code;
    this.warehouseError = '';
    this.cdr.markForCheck();
  }

  warehouseStatusLabel(wh: WarehouseStatus): string {
    return wh.hasGoods ? 'Có hàng' : 'Không có hàng';
  }

  warehouseInstruction(code: WarehouseCode): string {
    const wh = this.warehouseStatuses[code];
    if (!wh) return '—';

    if (code === 'ASM1') {
      return wh.hasGoods
        ? '8:00 — Có hàng tại ASM1. Chờ lên hàng để chở qua ASM3.'
        : '8:00 — Không có hàng tại ASM1. 9:00 chạy qua ASM3.';
    }

    if (code === 'ASM2') {
      return wh.hasGoods
        ? 'Có hàng tại ASM2 — Thực hiện nhập hàng hoặc lấy hàng theo thông báo ASM3.'
        : 'Không có hàng tại ASM2 — Chờ thông báo từ ASM3.';
    }

    switch (wh.asm3Scenario) {
      case 'return_asm1':
        return '9:00 — Kiểm tra ASM3: Có hàng về ASM1 → Về ASM1 nhập hàng.';
      case 'to_asm2':
        return '9:00 — Kiểm tra ASM3: Có hàng đi ASM2 → Đi ASM2 nhập hàng.';
      case 'pickup_asm2':
        return '9:00 — Kiểm tra ASM3: Hàng ASM2 về ASM1 → Qua ASM2 lấy hàng về ASM1.';
      case 'no_shipment':
      default:
        return '9:00 — Kiểm tra ASM3: Không có hàng → Quay về ASM1 chờ.';
    }
  }

  warehouseDriverAction(code: WarehouseCode): string {
    const wh = this.warehouseStatuses[code];
    if (!wh) return '—';

    if (code === 'ASM1') {
      return wh.hasGoods ? 'Chờ lên hàng, chờ qua ASM3' : '9:00 chạy qua ASM3';
    }
    if (code === 'ASM2') {
      return wh.hasGoods ? 'Nhập hàng / lấy hàng tại ASM2' : 'Quay về hoặc chờ';
    }

    switch (wh.asm3Scenario) {
      case 'return_asm1':
        return 'Về ASM1 nhập hàng';
      case 'to_asm2':
        return 'Đi ASM2 nhập hàng';
      case 'pickup_asm2':
        return 'Qua ASM2 lấy hàng về ASM1';
      case 'no_shipment':
      default:
        return 'Quay về ASM1 chờ';
    }
  }

  async loadWarehouseStatuses(): Promise<void> {
    this.isWarehouseLoading = true;
    this.warehouseError = '';
    this.cdr.markForCheck();

    const dayKey = this.warehouseTodayDayKey;
    const next: Record<WarehouseCode, WarehouseStatus> = {
      ASM1: { code: 'ASM1', hasGoods: false, asm3Scenario: 'no_shipment' },
      ASM2: { code: 'ASM2', hasGoods: false, asm3Scenario: 'no_shipment' },
      ASM3: { code: 'ASM3', hasGoods: false, asm3Scenario: 'no_shipment' }
    };
    let hasData = false;

    try {
      const snap = await this.firestore
        .collection(this.WAREHOUSE_COLLECTION, (ref) => ref.where('dayKey', '==', dayKey).limit(10))
        .get()
        .toPromise();

      for (const doc of snap?.docs || []) {
        hasData = true;
        const d = doc.data() as any;
        const code = String(d.code || doc.id.split('_').pop() || '')
          .trim()
          .toUpperCase() as WarehouseCode;
        if (!this.WAREHOUSE_CODES.includes(code)) continue;

        const scenario = this.normalizeAsm3Scenario(d.asm3Scenario);
        const hasGoods = d.hasGoods === true;

        next[code] = {
          code,
          hasGoods: code === 'ASM3' ? scenario !== 'no_shipment' : hasGoods,
          asm3Scenario: code === 'ASM3' ? scenario : 'no_shipment',
          updatedAt: d.updatedAt?.toDate?.() || undefined,
          updatedByName: String(d.updatedByName || '').trim() || undefined
        };
      }

      this.warehouseStatuses = next;
      this.warehouseTodayHasData = hasData;
    } catch (e) {
      console.error('loadWarehouseStatuses error', e);
      this.warehouseError = 'Không tải được lịch chạy cố định hôm nay.';
    } finally {
      this.isWarehouseLoading = false;
      this.cdr.markForCheck();
    }
  }

  async setWarehouseHasGoods(code: WarehouseCode, hasGoods: boolean): Promise<void> {
    if (!this.canApprove || this.isWarehouseSaving) return;

    if (code === 'ASM3' && hasGoods) {
      await this.setAsm3Scenario('return_asm1');
      return;
    }

    const asm3Scenario: Asm3Scenario = code === 'ASM3' ? 'no_shipment' : 'no_shipment';
    await this.saveWarehouseStatus(code, hasGoods, asm3Scenario);
  }

  async setAsm3Scenario(scenario: Asm3Scenario): Promise<void> {
    if (!this.canApprove || this.isWarehouseSaving) return;

    const hasGoods = scenario !== 'no_shipment';
    await this.saveWarehouseStatus('ASM3', hasGoods, scenario);
  }

  private normalizeAsm3Scenario(raw: any): Asm3Scenario {
    const v = String(raw || '').trim();
    if (v === 'return_asm1' || v === 'to_asm2' || v === 'pickup_asm2' || v === 'no_shipment') return v;
    return 'no_shipment';
  }

  private warehouseDocId(code: WarehouseCode): string {
    return `${this.warehouseTodayDayKey}_${code}`;
  }

  private async saveWarehouseStatus(code: WarehouseCode, hasGoods: boolean, asm3Scenario: Asm3Scenario): Promise<void> {
    this.isWarehouseSaving = true;
    this.warehouseError = '';
    this.cdr.markForCheck();

    try {
      const payload: Record<string, unknown> = {
        dayKey: this.warehouseTodayDayKey,
        dateYmd: this.warehouseTodayYmd,
        code,
        hasGoods,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedByUid: String(this.currentUser?.uid || ''),
        updatedByName: String(this.currentUser?.displayName || this.currentUser?.email || '')
      };
      if (code === 'ASM3') {
        payload.asm3Scenario = asm3Scenario;
      }

      await this.firestore.collection(this.WAREHOUSE_COLLECTION).doc(this.warehouseDocId(code)).set(payload, { merge: true });
      await this.loadWarehouseStatuses();
      this.selectedWarehouse = code;
    } catch (e) {
      console.error('saveWarehouseStatus error', e);
      this.warehouseError = 'Cập nhật lịch chạy cố định hôm nay thất bại.';
    } finally {
      this.isWarehouseSaving = false;
      this.cdr.markForCheck();
    }
  }

  selectDay(cell: CalendarCell): void {
    // Chủ nhật và ngày đã bị block thì không chọn được
    if (cell.isSunday || cell.blocked) return;
    this.selectedDayYmd = cell.ymd;
    this.cdr.markForCheck();
  }

  onDayRightClick(e: MouseEvent, cell: CalendarCell): void {
    e.preventDefault();
    if (!this.canApprove) return;
    if (cell.isSunday) return;

    const dayKey = this.toDayKey(cell.ymd);

    if (this.blockedDayKeys.has(dayKey)) {
      const pass = String(prompt('Nhập pass để unblock ngày') || '').trim();
      if (pass !== this.BLOCK_PASS) {
        alert('Sai pass.');
        return;
      }
      const ok = confirm(`Unblock ngày ${cell.ymd}?`);
      if (!ok) return;

      void this.firestore
        .collection(this.BLOCKED_COLLECTION)
        .doc(String(dayKey))
        .delete()
        .then(() => this.loadRange(this.rangeStart, this.rangeEnd))
        .catch((err) => {
          console.error('unblockDay error', err);
          alert('Unblock ngày thất bại. Vui lòng thử lại.');
        });
      return;
    }

    const pass = String(prompt('Nhập pass để block ngày') || '').trim();
    if (pass !== this.BLOCK_PASS) {
      alert('Sai pass.');
      return;
    }

    void this.firestore
      .collection(this.BLOCKED_COLLECTION)
      .doc(String(dayKey))
      .set(
        {
          dayKey,
          dateYmd: cell.ymd,
          blockedAt: firebase.firestore.FieldValue.serverTimestamp(),
          blockedByUid: String(this.currentUser?.uid || ''),
          blockedByName: String(this.currentUser?.displayName || this.currentUser?.email || '')
        },
        { merge: true }
      )
      .then(() => this.loadRange(this.rangeStart, this.rangeEnd))
      .catch((err) => {
        console.error('blockDay error', err);
        alert('Block ngày thất bại. Vui lòng thử lại.');
      });
  }

  get selectedDayRequests(): TruckDeliveryRequest[] {
    return this.requestsByDay.get(this.selectedDayYmd) || [];
  }

  // Vì yêu cầu: mỗi ngày chỉ có 1 lượt đặt xe,
  // nên box hiển thị lệnh giao hàng chỉ lấy 1 request ưu tiên nhất.
  get selectedDayPrimaryRequest(): TruckDeliveryRequest | null {
    const arr = this.selectedDayRequests || [];
    if (arr.length === 0) return null;

    const prio = (s: TruckRequestStatus) => {
      switch (s) {
        case 'approved':
          return 0;
        case 'rescheduled':
          return 1;
        case 'pending':
          return 2;
        case 'rejected':
          return 3;
        default:
          return 4;
      }
    };

    let best: TruckDeliveryRequest | null = null;
    for (const r of arr) {
      if (!best) {
        best = r;
        continue;
      }
      if (prio(r.status) < prio(best.status)) best = r;
    }
    return best;
  }

  get selectedDayPendingRequest(): TruckDeliveryRequest | null {
    const primary = this.selectedDayPrimaryRequest;
    return primary?.status === 'pending' ? primary : null;
  }

  get selectedDayApprovedRequest(): TruckDeliveryRequest | null {
    const primary = this.selectedDayPrimaryRequest;
    return primary?.status === 'approved' ? primary : null;
  }

  get selectedDayRejectedRequest(): TruckDeliveryRequest | null {
    const primary = this.selectedDayPrimaryRequest;
    return primary?.status === 'rejected' ? primary : null;
  }

  // Lệnh chưa được đồng ý => pending hoặc rescheduled (chờ chủ lệnh xác nhận)
  get selectedDayUnconfirmedRequest(): TruckDeliveryRequest | null {
    const primary = this.selectedDayPrimaryRequest;
    return primary?.status === 'pending' || primary?.status === 'rescheduled' ? primary : null;
  }

  isRowRequester(row: TruckDeliveryRequest): boolean {
    const uid = String(this.currentUser?.uid || '').trim();
    if (uid && String(row.createdByUid || '').trim() === uid) return true;

    // Fallback: một số record cũ có thể thiếu createdByUid/khác định dạng,
    // nên so theo mã nhân viên (employeeCode) của người đặt.
    const empId = String(this.currentUser?.employeeId || '').trim().toUpperCase();
    const rowEmp = String(row.employeeCode || '').trim().toUpperCase();
    if (empId && rowEmp && empId === rowEmp) return true;

    return false;
  }

  async confirmRescheduledByRequester(row: TruckDeliveryRequest): Promise<void> {
    if (!row?.id) return;
    if (row.status !== 'rescheduled') return;
    if (!this.isRowRequester(row)) return;

    try {
      await this.firestore.collection(this.COLLECTION).doc(row.id).set(
        {
          status: 'approved',
          // Giữ các thông tin approvedAt/approvedBy đã được warehouse set khi đổi lịch
          warehouseNote: row.warehouseNote || null
        },
        { merge: true }
      );
      await this.loadRange(this.rangeStart, this.rangeEnd);
      alert('✅ Đã xác nhận ngày mới. Lệnh được đưa lên lịch.');
    } catch (e) {
      console.error('confirmRescheduledByRequester error', e);
      alert('Xác nhận thất bại. Vui lòng thử lại.');
    }
  }

  trackByYmd(_: number, cell: CalendarCell): string {
    return cell.ymd;
  }

  trackByReqId(_: number, row: TruckDeliveryRequest): string {
    return row.id;
  }

  // ===== Data loading =====
  private toDayKey(ymd: string): number {
    // YYYY-MM-DD -> YYYYMMDD
    const parts = ymd.split('-');
    const y = parts[0] || '0';
    const m = parts[1] || '00';
    const d = parts[2] || '00';
    return Number(`${y}${m}${d}`) || 0;
  }

  private async isDayBlocked(dayKey: number): Promise<boolean> {
    if (this.blockedDayKeys.has(dayKey)) return true;
    const doc = await this.firestore.collection(this.BLOCKED_COLLECTION).doc(String(dayKey)).get().toPromise();
    return !!doc?.exists;
  }

  toYmd(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private isSameYmd(a: Date, ymd: string): boolean {
    return this.toYmd(a) === ymd;
  }

  private addDays(d: Date, days: number): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
  }

  private getWeekStartMonday(d: Date): Date {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const jsDow = x.getDay(); // 0..6 (Sun..Sat)
    const offset = (jsDow + 6) % 7; // 0 if Monday, 6 if Sunday
    return this.addDays(x, -offset);
  }

  private buildTwoWeekCalendar(rangeStart: Date): void {
    const today = new Date();
    const w1: CalendarCell[] = [];
    const w2: CalendarCell[] = [];
    for (let i = 0; i < 14; i++) {
      const d = this.addDays(rangeStart, i);
      const isSunday = d.getDay() === 0;
      const cell: CalendarCell = {
        date: d,
        ymd: this.toYmd(d),
        isToday: this.isSameYmd(today, this.toYmd(d)),
        isSunday,
        blocked: false,
        approvedCount: 0,
        pendingCount: 0,
        rejectedCount: 0,
        rescheduledCount: 0
      };
      if (i < 7) w1.push(cell);
      else w2.push(cell);
    }
    this.calendarWeeks = [w1, w2];
  }

  private applyRangeData(): void {
    this.requestsByDay = new Map<string, TruckDeliveryRequest[]>();
    for (const r of this.rangeRequests) {
      const arr = this.requestsByDay.get(r.dateYmd) || [];
      arr.push(r);
      this.requestsByDay.set(r.dateYmd, arr);
    }

    // sort per day: approved -> rescheduled -> pending -> rejected, by createdAt
    for (const [k, arr] of this.requestsByDay.entries()) {
      arr.sort((a, b) => {
        const prio = (s: TruckRequestStatus) => {
          switch (s) {
            case 'approved':
              return 0;
            case 'rescheduled':
              return 1;
            case 'pending':
              return 2;
            case 'rejected':
              return 3;
            default:
              return 4;
          }
        };
        const sa = prio(a.status);
        const sb = prio(b.status);
        if (sa !== sb) return sa - sb;
        const ta = a.createdAt?.getTime?.() || 0;
        const tb = b.createdAt?.getTime?.() || 0;
        return ta - tb;
      });
      this.requestsByDay.set(k, arr);
    }

    // fill counts into calendar
    const byDayCount = new Map<string, { a: number; p: number; r: number; s: number }>();
    for (const r of this.rangeRequests) {
      const v = byDayCount.get(r.dateYmd) || { a: 0, p: 0, r: 0, s: 0 };
      if (r.status === 'approved') v.a += 1;
      else if (r.status === 'pending') v.p += 1;
      else if (r.status === 'rescheduled') v.s += 1;
      else if (r.status === 'rejected') v.r += 1;
      byDayCount.set(r.dateYmd, v);
    }
    this.calendarWeeks = this.calendarWeeks.map((wk) =>
      wk.map((c) => {
        const v = byDayCount.get(c.ymd);
        return v
          ? { ...c, approvedCount: v.a, pendingCount: v.p, rejectedCount: v.r, rescheduledCount: v.s }
          : c;
      })
    );
  }

  private async loadCurrentRange(): Promise<void> {
    this.rangeStart = this.getWeekStartMonday(new Date());
    this.rangeEnd = this.addDays(this.rangeStart, 13);
    await this.loadRange(this.rangeStart, this.rangeEnd);
  }

  async loadRange(rangeStart: Date, rangeEnd: Date): Promise<void> {
    this.isLoadingRange = true;
    this.loadError = '';
    this.buildTwoWeekCalendar(rangeStart);

    try {
      const startKey = this.toDayKey(this.toYmd(rangeStart));
      const endKey = this.toDayKey(this.toYmd(rangeEnd));
      const [requestsSnapshot, blockedSnapshot] = await Promise.all([
        this.firestore
          .collection(this.COLLECTION, (ref) =>
            ref.where('dayKey', '>=', startKey).where('dayKey', '<=', endKey).limit(2000)
          )
          .get()
          .toPromise(),
        this.firestore
          .collection(this.BLOCKED_COLLECTION, (ref) =>
            ref.where('dayKey', '>=', startKey).where('dayKey', '<=', endKey).limit(2000)
          )
          .get()
          .toPromise()
      ]);

      const blockedDocs = blockedSnapshot?.docs || [];
      this.blockedDayKeys = new Set<number>();
      for (const doc of blockedDocs) {
        const d = doc.data() as any;
        const dk = Number(d?.dayKey ?? doc.id ?? 0) || 0;
        if (dk > 0) this.blockedDayKeys.add(dk);
      }

      this.rangeRequests = (requestsSnapshot?.docs || []).map((doc) => {
        const d = doc.data() as any;
        const rawStatus = String(d.status || 'pending').trim();
        const status: TruckRequestStatus =
          rawStatus === 'approved'
            ? 'approved'
            : rawStatus === 'rejected'
              ? 'rejected'
              : rawStatus === 'rescheduled'
                ? 'rescheduled'
                : 'pending';
        const warehouseNote = String(d.warehouseNote || '').trim() || undefined;
        return {
          id: doc.id,
          status,
          dateYmd: String(d.dateYmd || ''),
          monthKey: Number(d.monthKey || 0) || 0,
          dayKey: Number(d.dayKey || 0) || 0,

          employeeCode: String(d.employeeCode || '').trim(),
          employeeName: String(d.employeeName || '').trim(),
          department: (String(d.department || 'WH').trim().toUpperCase() as DepartmentCode) || 'WH',

          deliveryPlace: String(d.deliveryPlace || '').trim(),
          pickupPlace: String(d.pickupPlace || '').trim(),
          receiverName: String(d.receiverName || '').trim(),
          receiverPhone: String(d.receiverPhone || '').trim(),
          receiverLocationLink: String(d.receiverLocationLink || '').trim() || undefined,

          createdAt: d.createdAt?.toDate?.() || undefined,
          createdByUid: String(d.createdByUid || '') || undefined,
          createdByEmail: String(d.createdByEmail || '') || undefined,

          approvedAt: d.approvedAt?.toDate?.() || undefined,
          approvedByUid: String(d.approvedByUid || '') || undefined,
          approvedByName: String(d.approvedByName || '') || undefined,

          warehouseNote
        } as TruckDeliveryRequest;
      });

      // Apply blocked state into calendar cells
      this.calendarWeeks = this.calendarWeeks.map((wk) =>
        wk.map((c) => ({
          ...c,
          blocked: this.blockedDayKeys.has(this.toDayKey(c.ymd))
        }))
      );

      // Clamp selected day into range + not Sunday + not blocked
      const startYmd = this.toYmd(rangeStart);
      const endYmd = this.toYmd(rangeEnd);
      let wanted = this.selectedDayYmd;
      if (wanted < startYmd || wanted > endYmd) wanted = startYmd;
      let wantedCell: CalendarCell | undefined;
      for (const wk of this.calendarWeeks) {
        const f = wk.find((x) => x.ymd === wanted);
        if (f) {
          wantedCell = f;
          break;
        }
      }

      if (!wantedCell || wantedCell.isSunday || wantedCell.blocked) {
        let first: CalendarCell | undefined;
        for (const wk of this.calendarWeeks) {
          const f = wk.find((x) => !x.isSunday && !x.blocked);
          if (f) {
            first = f;
            break;
          }
        }
        if (!first) {
          first = this.calendarWeeks[0]?.[0];
        }
        this.selectedDayYmd = first?.ymd || startYmd;
      }

      this.applyRangeData();
    } catch (e: any) {
      console.error('loadRange error', e);
      this.loadError = 'Không tải được lịch xe (2 tuần). Vui lòng thử lại.';
    } finally {
      this.isLoadingRange = false;
      this.cdr.markForCheck();
    }
  }

  // ===== Register modal =====
  openRegisterModal(): void {
    const todayYmd = this.toYmd(new Date());
    this.submitError = '';
    this.regEmployeeCode = String(this.currentUser?.employeeId || '').trim() || this.regEmployeeCode;
    this.regEmployeeName = String(this.currentUser?.displayName || '').trim() || this.regEmployeeName;
    const dept = String(this.currentUser?.department || '').trim().toUpperCase();
    if (this.departments.includes(dept as DepartmentCode)) {
      this.regDepartment = dept as DepartmentCode;
    }
    // Giới hạn đăng ký trong 2 tuần hiển thị
    const minYmd = this.toYmd(this.rangeStart);
    const maxYmd = this.toYmd(this.rangeEnd);
    const picked = this.selectedDayYmd || todayYmd;
    this.regDateYmd = picked < minYmd ? minYmd : picked > maxYmd ? maxYmd : picked;
    this.regDeliveryPlace = '';
    this.regPickupPlace = '';
    this.regReceiverName = '';
    this.regReceiverPhone = '';
    this.regReceiverLocationLink = '';
    this.showRegisterModal = true;
    this.cdr.markForCheck();
  }

  closeRegisterModal(): void {
    if (this.isSubmitting) return;
    this.showRegisterModal = false;
    this.cdr.markForCheck();
  }

  private normPhone(raw: string): string {
    return String(raw || '').trim().replace(/\s+/g, '');
  }

  async submitRegister(): Promise<void> {
    this.submitError = '';
    const employeeCode = String(this.regEmployeeCode || '').trim().toUpperCase();
    const employeeName = String(this.regEmployeeName || '').trim();
    const department = this.regDepartment;
    const dateYmd = String(this.regDateYmd || '').trim();
    const deliveryPlace = String(this.regDeliveryPlace || '').trim();
    const pickupPlace = String(this.regPickupPlace || '').trim();
    const receiverName = String(this.regReceiverName || '').trim();
    const receiverPhone = this.normPhone(this.regReceiverPhone || '');
    const receiverLocationLink = String(this.regReceiverLocationLink || '').trim();

    if (!employeeCode || !employeeName) {
      this.submitError = 'Thiếu mã nhân viên hoặc tên.';
      this.cdr.markForCheck();
      return;
    }
    if (!dateYmd || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
      this.submitError = 'Ngày không hợp lệ.';
      this.cdr.markForCheck();
      return;
    }
    const minYmd = this.toYmd(this.rangeStart);
    const maxYmd = this.toYmd(this.rangeEnd);
    if (dateYmd < minYmd || dateYmd > maxYmd) {
      this.submitError = `Chỉ đăng ký trong khoảng ${minYmd} → ${maxYmd}.`;
      this.cdr.markForCheck();
      return;
    }

    const [yy, mm, dd] = dateYmd.split('-').map((v) => Number(v) || 0);
    const dt = new Date(yy, mm - 1, dd);
    if (dt.getDay() === 0) {
      this.submitError = 'Chủ nhật không chọn được.';
      this.cdr.markForCheck();
      return;
    }

    const dayKey = this.toDayKey(dateYmd);
    if (this.blockedDayKeys.has(dayKey)) {
      this.submitError = 'Ngày này đã bị block. Không thể đăng ký.';
      this.cdr.markForCheck();
      return;
    }

    // Một ngày chỉ có thể có 1 lượt đặt xe => kiểm tra trùng dayKey
    const existingSnap = await this.firestore
      .collection(this.COLLECTION, (ref) => ref.where('dayKey', '==', dayKey).limit(1))
      .get()
      .toPromise();
    if ((existingSnap?.docs?.length || 0) > 0) {
      this.submitError = 'Ngày này đã có lệnh đặt xe. Không thể đăng ký thêm.';
      this.cdr.markForCheck();
      return;
    }
    if (!deliveryPlace || !pickupPlace) {
      this.submitError = 'Thiếu Nơi giao hàng hoặc Nơi nhận hàng.';
      this.cdr.markForCheck();
      return;
    }
    if (!receiverName || !receiverPhone) {
      this.submitError = 'Thiếu tên người nhận hoặc số điện thoại.';
      this.cdr.markForCheck();
      return;
    }

    this.isSubmitting = true;
    this.cdr.markForCheck();
    try {
      const [y, m] = dateYmd.split('-').map((v) => Number(v) || 0);
      const monthKey = (y || 0) * 100 + (m || 0);
      const dayKey = this.toDayKey(dateYmd);
      await this.firestore.collection(this.COLLECTION).add({
        status: 'pending',
        dateYmd,
        monthKey,
        dayKey,

        employeeCode,
        employeeName,
        department,

        deliveryPlace,
        pickupPlace,
        receiverName,
        receiverPhone,
        receiverLocationLink: receiverLocationLink || null,

        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdByUid: String(this.currentUser?.uid || ''),
        createdByEmail: String(this.currentUser?.email || ''),
        createdByName: String(this.currentUser?.displayName || '')
      });

      this.showRegisterModal = false;
      await this.loadRange(this.rangeStart, this.rangeEnd);
    } catch (e: any) {
      console.error('submitRegister error', e);
      this.submitError = 'Gửi đăng ký thất bại. Vui lòng thử lại.';
    } finally {
      this.isSubmitting = false;
      this.cdr.markForCheck();
    }
  }

  // ===== Decision (Từ chối / Đồng ý / Đổi lịch) =====
  openDecisionModal(row: TruckDeliveryRequest): void {
    if (!this.canApprove) return;
    if (!row?.id) return;
    if (row.status !== 'pending') return;

    const pass = String(prompt('Nhập pass để xử lý lệnh giao hàng') || '').trim();
    if (pass !== this.APPROVE_PASS) {
      alert('Sai pass.');
      return;
    }

    this.decisionTarget = row;
    this.rescheduleDateYmd = row.dateYmd;
    this.showRescheduleInput = false;
    this.decisionNote = '';
    this.decisionError = '';
    this.showDecisionModal = true;
    this.isDecisionProcessing = false;
    this.cdr.markForCheck();
  }

  closeDecisionModal(): void {
    if (this.isDecisionProcessing) return;
    this.showDecisionModal = false;
    this.decisionTarget = null;
    this.showRescheduleInput = false;
    this.rescheduleDateYmd = '';
    this.decisionNote = '';
    this.decisionError = '';
    this.cdr.markForCheck();
  }

  async decideReject(): Promise<void> {
    if (!this.decisionTarget?.id) return;
    if (!this.canApprove) return;
    if (this.isDecisionProcessing) return;

    this.isDecisionProcessing = true;
    this.decisionError = '';
    this.cdr.markForCheck();

    try {
      await this.firestore.collection(this.COLLECTION).doc(this.decisionTarget.id).set(
        {
          status: 'rejected',
          approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
          approvedByUid: String(this.currentUser?.uid || ''),
          approvedByName: String(this.currentUser?.displayName || this.currentUser?.email || ''),
          warehouseNote: String(this.decisionNote || '').trim() || null
        },
        { merge: true }
      );

      this.isDecisionProcessing = false;
      this.closeDecisionModal();
      await this.loadRange(this.rangeStart, this.rangeEnd);
      alert('✅ Đã từ chối (Không đặt được).');
    } catch (e) {
      console.error('decideReject error', e);
      this.decisionError = 'Từ chối thất bại. Vui lòng thử lại.';
      this.isDecisionProcessing = false;
      this.cdr.markForCheck();
    }
  }

  async decideApprove(): Promise<void> {
    if (!this.decisionTarget?.id) return;
    if (!this.canApprove) return;
    if (this.isDecisionProcessing) return;

    this.isDecisionProcessing = true;
    this.decisionError = '';
    this.cdr.markForCheck();

    try {
      await this.firestore.collection(this.COLLECTION).doc(this.decisionTarget.id).set(
        {
          status: 'approved',
          approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
          approvedByUid: String(this.currentUser?.uid || ''),
          approvedByName: String(this.currentUser?.displayName || this.currentUser?.email || ''),
          warehouseNote: String(this.decisionNote || '').trim() || null
        },
        { merge: true }
      );

      this.isDecisionProcessing = false;
      this.closeDecisionModal();
      await this.loadRange(this.rangeStart, this.rangeEnd);
      alert('✅ Đã duyệt (Đã đặt).');
    } catch (e) {
      console.error('decideApprove error', e);
      this.decisionError = 'Duyệt thất bại. Vui lòng thử lại.';
      this.isDecisionProcessing = false;
      this.cdr.markForCheck();
    }
  }

  startReschedule(): void {
    this.showRescheduleInput = true;
    this.decisionError = '';
  }

  async confirmReschedule(): Promise<void> {
    if (!this.decisionTarget?.id) return;
    if (!this.canApprove) return;
    if (this.isDecisionProcessing) return;

    this.isDecisionProcessing = true;
    this.decisionError = '';
    this.cdr.markForCheck();

    const ymd = String(this.rescheduleDateYmd || '').trim();
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      this.decisionError = 'Ngày không hợp lệ.';
      this.isDecisionProcessing = false;
      this.cdr.markForCheck();
      return;
    }

    const [yy, mm, dd] = ymd.split('-').map((v) => Number(v) || 0);
    const dt = new Date(yy, mm - 1, dd);
    if (dt.getDay() === 0) {
      this.decisionError = 'Chủ nhật không chọn được.';
      this.isDecisionProcessing = false;
      this.cdr.markForCheck();
      return;
    }

    const targetDayKey = this.toDayKey(ymd);
    if (await this.isDayBlocked(targetDayKey)) {
      this.decisionError = 'Ngày này đã bị block.';
      this.isDecisionProcessing = false;
      this.cdr.markForCheck();
      return;
    }

    // Một ngày chỉ có thể có 1 lượt đặt xe
    const existingSnap = await this.firestore
      .collection(this.COLLECTION, (ref) => ref.where('dayKey', '==', targetDayKey).limit(1))
      .get()
      .toPromise();
    const existingDoc = existingSnap?.docs?.[0];
    if (existingDoc && String(existingDoc.id) !== this.decisionTarget.id) {
      this.decisionError = 'Ngày mới đã có lệnh đặt xe. Không thể đổi lịch.';
      this.isDecisionProcessing = false;
      this.cdr.markForCheck();
      return;
    }

    try {
      // yyyy-MM-dd -> monthKey + dayKey
      const monthKey = (yy || 0) * 100 + (mm || 0);
      const dayKey = this.toDayKey(ymd);

      await this.firestore.collection(this.COLLECTION).doc(this.decisionTarget.id).set(
        {
          status: 'rescheduled',
          dateYmd: ymd,
          monthKey,
          dayKey,
          approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
          approvedByUid: String(this.currentUser?.uid || ''),
          approvedByName: String(this.currentUser?.displayName || this.currentUser?.email || ''),
          warehouseNote: String(this.decisionNote || '').trim() || null
        },
        { merge: true }
      );

      const minYmd = this.toYmd(this.rangeStart);
      const maxYmd = this.toYmd(this.rangeEnd);
      const outOfRange = ymd < minYmd || ymd > maxYmd;

      this.isDecisionProcessing = false;
      this.closeDecisionModal();
      await this.loadRange(this.rangeStart, this.rangeEnd);
      alert(outOfRange ? '✅ Đổi lịch thành công (có thể không hiển thị vì ngoài 2 tuần).'
        : '✅ Đổi lịch thành công.');
    } catch (e) {
      console.error('confirmReschedule error', e);
      this.decisionError = 'Đổi lịch thất bại. Vui lòng thử lại.';
      this.isDecisionProcessing = false;
      this.cdr.markForCheck();
    }
  }

  // ===== Delete (pass) =====
  async requestDelete(row: TruckDeliveryRequest): Promise<void> {
    if (!this.canDelete) return;
    if (!row?.id) return;

    const pass = String(prompt('Nhập pass để Xóa lệnh') || '').trim();
    if (pass !== this.DELETE_PASS) {
      alert('Sai pass.');
      return;
    }

    const ok = confirm(`Xóa lệnh giao hàng ngày ${row.dateYmd} của ${row.employeeCode}?`);
    if (!ok) return;

    try {
      await this.firestore.collection(this.COLLECTION).doc(row.id).delete();
      await this.loadRange(this.rangeStart, this.rangeEnd);
      alert('✅ Đã xóa lệnh giao hàng.');
    } catch (e) {
      console.error('requestDelete error', e);
      alert('Xóa thất bại. Vui lòng thử lại.');
      this.cdr.markForCheck();
    }
  }

  // ===== Download / print delivery order =====
  async downloadDeliveryOrder(row: TruckDeliveryRequest): Promise<void> {
    if (!row?.id) return;
    try {
      const QRCode = (await import('qrcode')) as any;
      const hasLink = !!(row.receiverLocationLink && row.receiverLocationLink.trim());
      const qrImage = hasLink
        ? await QRCode.toDataURL(String(row.receiverLocationLink).trim(), {
            width: 220,
            margin: 1,
            color: { dark: '#000000', light: '#FFFFFF' }
          })
        : '';

      const esc = (value: unknown) =>
        String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');

      const win = window.open('', '_blank');
      if (!win) {
        alert('Trình duyệt chặn cửa sổ in. Cho phép popup và thử lại.');
        return;
      }

      const title = 'LỆNH GIAO HÀNG';
      const statusLabel =
        row.status === 'approved'
          ? 'APPROVED'
          : row.status === 'rejected'
            ? 'NOT SET'
            : row.status === 'rescheduled'
              ? 'RESCHEDULED'
              : 'PENDING';

      const statusInfo =
        row.status === 'approved'
          ? `<div class="kv"><span class="k">Approved by</span><span class="v">${esc(row.approvedByName || '')}</span></div>`
          : row.status === 'rejected'
            ? `<div class="kv"><span class="k">Rejected by</span><span class="v">${esc(row.approvedByName || '')}</span></div>`
            : row.status === 'rescheduled'
              ? `<div class="kv"><span class="k">Rescheduled by</span><span class="v">${esc(row.approvedByName || '')}</span></div>`
              : '';

      win.document.write(`
        <html>
          <head>
            <meta charset="utf-8" />
            <title></title>
            <style>
              * { box-sizing: border-box; }
              body { margin: 18px; font-family: Arial, sans-serif; color: #0f172a; }
              .page { max-width: 860px; margin: 0 auto; }
              .hdr { display:flex; align-items:flex-start; justify-content:space-between; gap: 12px; }
              .hdr h1 { margin:0; font-size: 22px; letter-spacing: .6px; }
              .status { font-weight: 800; font-size: 12px; padding: 6px 10px; border: 1px solid #0f172a; border-radius: 8px; }
              .grid { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 14px; }
              .card { border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px; }
              .card h3 { margin:0 0 10px 0; font-size: 14px; text-transform: uppercase; letter-spacing: .4px; color:#334155; }
              .kv { display:flex; justify-content:space-between; gap: 10px; padding: 6px 0; border-bottom: 1px dashed #e2e8f0; }
              .kv:last-child { border-bottom: 0; }
              .k { color:#475569; font-weight: 700; min-width: 160px; }
              .v { color:#0f172a; font-weight: 700; text-align:right; word-break: break-word; }
              .qrWrap { display:flex; gap: 12px; align-items:flex-start; }
              .qrBox { border: 1px solid #0f172a; border-radius: 10px; padding: 10px; width: 260px; }
              .qrBox img { width: 220px; height: 220px; display:block; }
              .qrHint { font-size: 12px; color:#475569; margin-top: 8px; line-height: 1.3; word-break: break-word; }
              .foot { margin-top: 16px; display:flex; justify-content:space-between; color:#475569; font-size: 12px; }
              .btnRow { margin-top: 16px; display:none; }
              @media print {
                body { margin: 0; }
                .page { padding: 16px; }
              }
            </style>
          </head>
          <body>
            <div class="page">
              <div class="hdr">
                <div>
                  <h1>${esc(title)}</h1>
                  <div style="margin-top:6px;color:#475569;font-size:12px;">Theo dõi lịch xe chạy</div>
                </div>
                <div class="status">${esc(statusLabel)}</div>
              </div>

              <div class="grid">
                <div class="card">
                  <h3>Thông tin đăng ký</h3>
                  <div class="kv"><span class="k">Ngày</span><span class="v">${esc(row.dateYmd)}</span></div>
                  <div class="kv"><span class="k">Mã nhân viên</span><span class="v">${esc(row.employeeCode)}</span></div>
                  <div class="kv"><span class="k">Tên</span><span class="v">${esc(row.employeeName)}</span></div>
                  <div class="kv"><span class="k">Bộ phận</span><span class="v">${esc(row.department)}</span></div>
                  ${statusInfo}
                </div>

                <div class="card">
                  <h3>Thông tin giao nhận</h3>
                  <div class="kv"><span class="k">Nơi nhận hàng</span><span class="v">${esc(row.pickupPlace)}</span></div>
                  <div class="kv"><span class="k">Nơi giao hàng</span><span class="v">${esc(row.deliveryPlace)}</span></div>
                  <div class="kv"><span class="k">Người nhận</span><span class="v">${esc(row.receiverName)}</span></div>
                  <div class="kv"><span class="k">SĐT</span><span class="v">${esc(row.receiverPhone)}</span></div>
                  <div class="kv"><span class="k">Link địa điểm nhận</span><span class="v">${esc(row.receiverLocationLink || '—')}</span></div>
                </div>
              </div>

              <div style="margin-top:12px;" class="card">
                <h3>Mã QR địa điểm (nếu có)</h3>
                <div class="qrWrap">
                  <div class="qrBox">
                    ${hasLink ? `<img src="${qrImage}" alt="QR" />` : `<div style="width:220px;height:220px;display:flex;align-items:center;justify-content:center;color:#64748b;">Không có link</div>`}
                    <div class="qrHint">${hasLink ? esc(row.receiverLocationLink) : '—'}</div>
                  </div>
                  <div style="flex:1;font-size:12px;color:#475569;line-height:1.4;">
                    <div><b>Lưu ý:</b> Nếu không có link địa điểm nhận, QR sẽ để trống.</div>
                    <div style="margin-top:8px;">In trang này để kẹp vào hồ sơ lệnh giao hàng.</div>
                  </div>
                </div>
              </div>

              <div class="foot">
                <div>Generated: ${esc(new Date().toLocaleString('vi-VN'))}</div>
                <div>Tab: Xe Tải</div>
              </div>

              <script>
                window.onload = function() { setTimeout(function(){ window.print(); }, 400); };
              </script>
            </div>
          </body>
        </html>
      `);
      win.document.close();
    } catch (e) {
      console.error('downloadDeliveryOrder error', e);
      alert('Không tải được lệnh giao hàng. Vui lòng thử lại.');
    }
  }
}

