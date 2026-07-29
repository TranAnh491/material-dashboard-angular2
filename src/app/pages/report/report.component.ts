import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { RmBagHistoryService } from '../../services/rm-bag-history.service';

/** Một khối số liệu (Carton + số mã hàng) cho 1 chiều (Nhập hoặc Xuất) của 1 nguồn (FG hoặc RM). */
export interface DaySection {
  /** null = không có dữ liệu carton đáng tin cho nguồn này (hiển thị "—"). */
  carton: number | null;
  /** Số mã hàng riêng biệt — FG: đếm theo materialCode; RM: đếm theo cặp materialCode+IMD. */
  codes: number;
  /** Ghi chú cảnh báo độ tin cậy của số carton (nếu có). */
  cartonCaveat?: string;
}

export interface DayStats {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  fgIn: DaySection;
  fgOut: DaySection;
  rmIn: DaySection;
  rmOut: DaySection;
}

interface CalendarCell {
  date: Date;
  dateKey: string;
  day: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  isFuture: boolean;
}

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

const RM_IN_CARTON_CAVEAT =
  'Số thùng NVL nhập lấy từ "số tem cần in" (cartonCount) — có thể không phản ánh đúng số thùng thực tế nếu nhân viên không nhập/không in tem.';

@Component({
  selector: 'app-report',
  templateUrl: './report.component.html',
  styleUrls: ['./report.component.scss']
})
export class ReportComponent implements OnDestroy {
  readonly weekdayLabels = WEEKDAY_LABELS;

  viewYear: number;
  viewMonth: number; // 0-11

  weeks: CalendarCell[][] = [];
  dayStats = new Map<string, DayStats>();

  showDetailFor: string | null = null;

  private readonly todayKey: string;

  constructor(
    private firestore: AngularFirestore,
    private rmBagHistory: RmBagHistoryService,
    private router: Router
  ) {
    const now = new Date();
    this.viewYear = now.getFullYear();
    this.viewMonth = now.getMonth();
    this.todayKey = this.toDateKey(now);
    this.buildCalendar();
  }

  ngOnDestroy(): void {}

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  get monthLabel(): string {
    return `Tháng ${this.viewMonth + 1}/${this.viewYear}`;
  }

  prevMonth(): void {
    this.viewMonth--;
    if (this.viewMonth < 0) {
      this.viewMonth = 11;
      this.viewYear--;
    }
    this.buildCalendar();
  }

  nextMonth(): void {
    this.viewMonth++;
    if (this.viewMonth > 11) {
      this.viewMonth = 0;
      this.viewYear++;
    }
    this.buildCalendar();
  }

  goToday(): void {
    const now = new Date();
    this.viewYear = now.getFullYear();
    this.viewMonth = now.getMonth();
    this.buildCalendar();
  }

  private toDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Dựng lưới các tuần (T2 → CN) phủ trọn tháng đang xem, có kéo dài đầu/cuối để đủ tuần. */
  private buildCalendar(): void {
    const firstOfMonth = new Date(this.viewYear, this.viewMonth, 1);
    // JS: 0=CN..6=T7 → quy đổi về tuần bắt đầu T2 (0=T2..6=CN)
    const jsDay = firstOfMonth.getDay();
    const leadOffset = (jsDay + 6) % 7;
    const gridStart = new Date(this.viewYear, this.viewMonth, 1 - leadOffset);

    const today0 = new Date();
    today0.setHours(0, 0, 0, 0);

    const weeks: CalendarCell[][] = [];
    const cursor = new Date(gridStart);
    for (let w = 0; w < 6; w++) {
      const week: CalendarCell[] = [];
      for (let i = 0; i < 7; i++) {
        const dateKey = this.toDateKey(cursor);
        const cellDate0 = new Date(cursor);
        cellDate0.setHours(0, 0, 0, 0);
        week.push({
          date: new Date(cursor),
          dateKey,
          day: cursor.getDate(),
          inCurrentMonth: cursor.getMonth() === this.viewMonth,
          isToday: dateKey === this.todayKey,
          isFuture: cellDate0.getTime() > today0.getTime()
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
      const lastCellInNextMonth = week[6].date.getMonth() !== this.viewMonth && week[6].date > firstOfMonth;
      if (w >= 3 && lastCellInNextMonth) break;
    }
    this.weeks = weeks;
  }

  getStats(dateKey: string): DayStats | null {
    return this.dayStats.get(dateKey) || null;
  }

  /** Bấm Run trên 1 ngày — chỉ đọc dữ liệu của đúng ngày đó (không tự tải cả tháng). */
  async runDay(cell: CalendarCell, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    if (cell.isFuture) return;
    const dateKey = cell.dateKey;
    const existing = this.dayStats.get(dateKey);
    if (existing?.loading) return;

    const stats: DayStats = {
      loading: true,
      loaded: false,
      error: null,
      fgIn: { carton: 0, codes: 0 },
      fgOut: { carton: 0, codes: 0 },
      rmIn: { carton: 0, codes: 0 },
      rmOut: { carton: null, codes: 0 }
    };
    this.dayStats.set(dateKey, stats);

    const dayStart = new Date(cell.date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(cell.date);
    dayEnd.setHours(23, 59, 59, 999);

    try {
      const [fgOut, fgIn, rmOut, rmIn] = await Promise.all([
        this.loadFgOut(dayStart, dayEnd),
        this.loadFgIn(dayStart, dayEnd),
        this.loadRmOut(dayStart, dayEnd),
        this.loadRmIn(dayStart, dayEnd)
      ]);
      this.dayStats.set(dateKey, {
        loading: false,
        loaded: true,
        error: null,
        fgOut,
        fgIn,
        rmOut,
        rmIn
      });
    } catch (e: unknown) {
      console.error('runDay failed', dateKey, e);
      const msg = e instanceof Error ? e.message : String(e);
      this.dayStats.set(dateKey, { ...stats, loading: false, error: msg });
    }
  }

  // ── Nguồn dữ liệu ────────────────────────────────────────────────────────
  // fg-out / fg-in: gộp cả ASM1 + ASM2 (2 collection này vốn đã chứa cả 2 nhà máy).
  // outbound-materials / inbound-materials: chỉ ASM1 (đúng theo 2 tab outbound-asm1 / inbound-asm1).

  private async loadFgOut(dayStart: Date, dayEnd: Date): Promise<DaySection> {
    const snap = await this.firestore
      .collection('fg-out', ref => ref.where('exportDate', '>=', dayStart).where('exportDate', '<=', dayEnd))
      .get()
      .toPromise();
    let carton = 0;
    const codes = new Set<string>();
    (snap?.docs || []).forEach(doc => {
      const d = doc.data() as Record<string, unknown>;
      carton += Number(d.carton) || 0;
      const code = String(d.materialCode || '').trim().toUpperCase();
      if (code) codes.add(code);
    });
    return { carton, codes: codes.size };
  }

  private async loadFgIn(dayStart: Date, dayEnd: Date): Promise<DaySection> {
    const snap = await this.firestore
      .collection('fg-in', ref => ref.where('importDate', '>=', dayStart).where('importDate', '<=', dayEnd))
      .get()
      .toPromise();
    let carton = 0;
    const codes = new Set<string>();
    (snap?.docs || []).forEach(doc => {
      const d = doc.data() as Record<string, unknown>;
      carton += Number(d.carton) || 0;
      const code = String(d.materialCode || '').trim().toUpperCase();
      if (code) codes.add(code);
    });
    return { carton, codes: codes.size };
  }

  /** outbound-materials (ASM1): KHÔNG có field carton nào — NVL xuất theo bao/cuộn, không theo thùng. */
  private async loadRmOut(dayStart: Date, dayEnd: Date): Promise<DaySection> {
    const snap = await this.firestore
      .collection('outbound-materials', ref =>
        ref.where('factory', '==', 'ASM1').where('exportDate', '>=', dayStart).where('exportDate', '<=', dayEnd)
      )
      .get()
      .toPromise();
    const codeImdSet = new Set<string>();
    (snap?.docs || []).forEach(doc => {
      const d = doc.data() as Record<string, unknown>;
      const code = String(d.materialCode || '').trim().toUpperCase();
      if (!code) return;
      // Lưu ý: trên collection này field tên "importDate" thực chất chứa chuỗi IMD (không phải ngày giao dịch).
      const imdRaw = String(d.importDate ?? '').trim();
      const imdKey = imdRaw ? this.rmBagHistory.parseQrPart4(imdRaw).imdKey || imdRaw : '';
      codeImdSet.add(`${code}|${imdKey}`);
    });
    return { carton: null, codes: codeImdSet.size };
  }

  private async loadRmIn(dayStart: Date, dayEnd: Date): Promise<DaySection> {
    const snap = await this.firestore
      .collection('inbound-materials', ref =>
        ref.where('factory', '==', 'ASM1').where('importDate', '>=', dayStart).where('importDate', '<=', dayEnd)
      )
      .get()
      .toPromise();
    let carton = 0;
    const codes = new Set<string>();
    (snap?.docs || []).forEach(doc => {
      const d = doc.data() as Record<string, unknown>;
      carton += Number(d.cartonCount) || 0;
      const code = String(d.materialCode || '').trim().toUpperCase();
      if (code) codes.add(code);
    });
    return { carton, codes: codes.size, cartonCaveat: RM_IN_CARTON_CAVEAT };
  }

  // ── Tổng hợp hiển thị (ô lịch rút gọn) ──────────────────────────────────
  totalInCarton(s: DayStats): number {
    return (s.fgIn.carton ?? 0) + (s.rmIn.carton ?? 0);
  }

  /** Chỉ tính carton FG — RM xuất không có dữ liệu carton nên không cộng vào (tránh hiểu nhầm là tổng thật). */
  totalOutCarton(s: DayStats): number {
    return s.fgOut.carton ?? 0;
  }

  totalInCodes(s: DayStats): number {
    return s.fgIn.codes + s.rmIn.codes;
  }

  totalOutCodes(s: DayStats): number {
    return s.fgOut.codes + s.rmOut.codes;
  }

  openDetail(dateKey: string, hasData: boolean, event?: Event): void {
    if (event) event.stopPropagation();
    if (!hasData) return;
    this.showDetailFor = dateKey;
  }

  closeDetail(): void {
    this.showDetailFor = null;
  }

  get detailStats(): DayStats | null {
    return this.showDetailFor ? this.dayStats.get(this.showDetailFor) || null : null;
  }

  get detailDateLabel(): string {
    if (!this.showDetailFor) return '';
    const [y, m, d] = this.showDetailFor.split('-');
    return `${d}/${m}/${y}`;
  }
}
