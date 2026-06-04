import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import {
  buildNhietDoFactoryGroups,
  NhietDoFactoryGroup,
  NhietDoFormDef,
  NhietDoFormType,
  TEMP_LIMITS_BY_FORM,
  TempChartLimits
} from './nhiet-do.model';

export interface DayTempHumReading {
  tempMorning?: number | null;
  tempAfternoon?: number | null;
  humidityMorning?: number | null;
  humidityAfternoon?: number | null;
  note?: string;
}

export interface TempHumChecklistDoc {
  year: number;
  month: number;
  factory?: string;
  formType?: string;
  formId?: string;
  equipmentName: string;
  days: DayTempHumReading[];
  assessmentSign?: string;
  inspectionSign?: string;
  updatedAt?: Date;
}

export type NhietDoView = 'picker' | 'form';

type DayNumberField = 'tempMorning' | 'tempAfternoon' | 'humidityMorning' | 'humidityAfternoon';

@Component({
  selector: 'app-nhiet-do',
  templateUrl: './nhiet-do.component.html',
  styleUrls: ['./nhiet-do.component.scss']
})
export class NhietDoComponent implements OnInit {
  readonly collection = 'warehouse-temp-humidity-checklists';
  readonly dayNumbers = Array.from({ length: 31 }, (_, i) => i + 1);
  readonly factoryGroups: NhietDoFactoryGroup[] = buildNhietDoFactoryGroups();

  view: NhietDoView = 'picker';
  activeForm: NhietDoFormDef | null = null;

  // Giới hạn độ ẩm: đỏ 25–75%, vàng 27–73%
  readonly humChart = { redLow: 25, redHigh: 75, warnLow: 27, warnHigh: 73 };

  // Lưới Y-axis cho độ ẩm (85→20%, mỗi 5%)
  readonly humGridLines = [85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 20];

  // ── SVG chart constants ──────────────────────────────────────────
  readonly svgLabelW = 76;   // = col-group(44) + col-slot(32) — left label area
  readonly svgDayW   = 26;   // width per day column
  readonly svgUclW   = 34;   // right label area
  readonly svgPadTop = 6;
  readonly svgPadBot = 18;
  readonly svgTempH  = 200;  // temperature zone height (px in viewBox)
  readonly svgHumH   = 260;  // humidity zone height
  readonly svgGap    = 30;   // gap between temp and hum zones
  // ────────────────────────────────────────────────────────────────

  selectedYear = new Date().getFullYear();
  selectedMonth = new Date().getMonth() + 1;
  equipmentName = '';
  assessmentSign = '';
  inspectionSign = '';
  days: DayTempHumReading[] = this.emptyDays();

  isLoading = false;
  isSaving = false;
  saveMessage = '';

  years: number[] = [];

  constructor(
    private firestore: AngularFirestore,
    private router: Router
  ) {
    const y = new Date().getFullYear();
    for (let i = y - 2; i <= y + 2; i++) this.years.push(i);
  }

  ngOnInit(): void {
    // Màn chọn biểu mẫu; load dữ liệu khi mở từng form
  }

  openForm(form: NhietDoFormDef): void {
    this.activeForm = form;
    this.view = 'form';
    this.saveMessage = '';
    void this.loadMonth();
  }

  backToPicker(): void {
    this.view = 'picker';
    this.activeForm = null;
    this.saveMessage = '';
  }

  get daysInMonth(): number {
    return new Date(this.selectedYear, this.selectedMonth, 0).getDate();
  }

  isDayActive(day: number): boolean {
    return day <= this.daysInMonth;
  }

  get tempLimits(): TempChartLimits {
    const type: NhietDoFormType = this.activeForm?.formType ?? 'special';
    return TEMP_LIMITS_BY_FORM[type];
  }

  get tempGridLines(): number[] {
    return this.tempLimits.gridLines;
  }

  private emptyDays(): DayTempHumReading[] {
    return Array.from({ length: 31 }, () => ({}));
  }

  private docId(): string {
    if (!this.activeForm) {
      return `${this.selectedYear}-${String(this.selectedMonth).padStart(2, '0')}`;
    }
    return `${this.activeForm.factory}-${this.activeForm.formType}-${this.selectedYear}-${String(this.selectedMonth).padStart(2, '0')}`;
  }

  /** Doc cũ (trước khi tách 6 biểu mẫu): ASM2 – Kho Lưu Trữ Đặc Biệt */
  private legacyDocId(): string | null {
    if (this.activeForm?.factory === 'ASM2' && this.activeForm?.formType === 'special') {
      return `${this.selectedYear}-${String(this.selectedMonth).padStart(2, '0')}`;
    }
    return null;
  }

  async loadMonth(): Promise<void> {
    if (!this.activeForm) return;
    this.isLoading = true;
    this.saveMessage = '';
    try {
      let snap = await this.firestore.collection(this.collection).doc(this.docId()).get().toPromise();
      if (!snap?.exists) {
        const legacyId = this.legacyDocId();
        if (legacyId) {
          snap = await this.firestore.collection(this.collection).doc(legacyId).get().toPromise();
        }
      }
      if (snap?.exists) {
        const d = snap.data() as TempHumChecklistDoc;
        this.equipmentName = d.equipmentName || '';
        this.assessmentSign = d.assessmentSign || '';
        this.inspectionSign = d.inspectionSign || '';
        const loaded = Array.isArray(d.days) ? d.days : [];
        this.days = this.emptyDays().map((empty, i) => ({ ...empty, ...(loaded[i] || {}) }));
      } else {
        this.equipmentName = '';
        this.assessmentSign = '';
        this.inspectionSign = '';
        this.days = this.emptyDays();
      }
    } catch (e) {
      console.error('[Nhiệt Độ] load failed:', e);
      this.saveMessage = 'Không tải được dữ liệu.';
    } finally {
      this.isLoading = false;
    }
  }

  async saveMonth(): Promise<void> {
    if (!this.activeForm) return;
    this.isSaving = true;
    this.saveMessage = '';
    try {
      const payload: TempHumChecklistDoc = {
        year: this.selectedYear,
        month: this.selectedMonth,
        factory: this.activeForm.factory,
        formType: this.activeForm.formType,
        formId: this.activeForm.id,
        equipmentName: this.equipmentName.trim(),
        days: this.days.map(d => ({
          tempMorning: this.numOrNull(d.tempMorning),
          tempAfternoon: this.numOrNull(d.tempAfternoon),
          humidityMorning: this.numOrNull(d.humidityMorning),
          humidityAfternoon: this.numOrNull(d.humidityAfternoon),
          note: (d.note || '').trim()
        })),
        assessmentSign: this.assessmentSign.trim(),
        inspectionSign: this.inspectionSign.trim(),
        updatedAt: new Date()
      };
      await this.firestore.collection(this.collection).doc(this.docId()).set(payload, { merge: true });
      this.saveMessage = 'Đã lưu thành công!';
      setTimeout(() => { this.saveMessage = ''; }, 3000);
    } catch (e) {
      console.error('[Nhiệt Độ] save failed:', e);
      this.saveMessage = 'Lỗi khi lưu dữ liệu.';
      setTimeout(() => { this.saveMessage = ''; }, 4000);
    } finally {
      this.isSaving = false;
    }
  }

  onMonthYearChange(): void {
    void this.loadMonth();
  }

  onDayNumberChange(day: number, field: DayNumberField, value: number | string | null): void {
    const idx = day - 1;
    if (idx < 0 || idx >= 31) return;
    let parsed: number | null = null;
    if (value !== '' && value !== null && value !== undefined) {
      const n = Number(value);
      parsed = Number.isFinite(n) ? n : null;
    }
    this.days[idx] = { ...this.days[idx], [field]: parsed };
    this.days = [...this.days];
  }

  private numOrNull(v: number | null | undefined): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  cellStatusClass(day: number, kind: 'temp' | 'hum', slot: 'morning' | 'afternoon'): string {
    return kind === 'temp' ? this.tempStatusClass(day, slot) : this.humStatusClass(day, slot);
  }

  tempStatusClass(day: number, slot: 'morning' | 'afternoon'): string {
    const d = this.days[day - 1];
    const v = Number(slot === 'morning' ? d?.tempMorning : d?.tempAfternoon);
    if (!Number.isFinite(v)) return '';
    const lim = this.tempLimits;
    if (v < lim.redLow || v > lim.redHigh) return 'cell--danger';
    if (v < lim.warnLow || v > lim.warnHigh) return 'cell--warn';
    return '';
  }

  humStatusClass(day: number, slot: 'morning' | 'afternoon'): string {
    const d = this.days[day - 1];
    const v = Number(slot === 'morning' ? d?.humidityMorning : d?.humidityAfternoon);
    if (!Number.isFinite(v)) return '';
    if (v <= this.humChart.redLow || v >= this.humChart.redHigh) return 'cell--danger';
    if (v <= this.humChart.warnLow || v >= this.humChart.warnHigh) return 'cell--warn';
    return '';
  }

  // ── SVG computed dimensions ──────────────────────────────────────
  get svgPlotW(): number { return 31 * this.svgDayW; }
  get svgTotalW(): number { return this.svgLabelW + this.svgPlotW + this.svgUclW; }
  get svgTempTop(): number { return this.svgPadTop; }
  get svgHumTop(): number  { return this.svgPadTop + this.svgTempH + this.svgGap; }
  get svgTotalH(): number  { return this.svgPadTop + this.svgTempH + this.svgGap + this.svgHumH + this.svgPadBot; }
  get svgViewBox(): string { return `0 0 ${this.svgTotalW} ${this.svgTotalH}`; }

  // Y coordinate in temperature zone (scaleMax=top, scaleMin=bottom)
  svgTempY(v: number): number {
    const { scaleMin, scaleMax } = this.tempLimits;
    const c = Math.max(scaleMin, Math.min(scaleMax, v));
    const span = scaleMax - scaleMin || 1;
    return this.svgTempH * (1 - (c - scaleMin) / span);
  }

  // Y coordinate in humidity zone (85%=top, 20%=bottom)
  svgHumY(v: number): number {
    const c = Math.max(20, Math.min(85, v));
    return this.svgHumH * (1 - (c - 20) / 65);
  }

  // X coordinate for day (center of column)
  svgDayX(day: number): number {
    return (day - 0.5) * this.svgDayW;
  }

  // Build polyline points for temperature
  private buildTempPolyline(slot: 'morning' | 'afternoon'): string {
    const pts: string[] = [];
    for (let d = 1; d <= this.daysInMonth; d++) {
      const v = slot === 'morning' ? this.days[d - 1]?.tempMorning : this.days[d - 1]?.tempAfternoon;
      if (v != null && Number.isFinite(Number(v))) {
        pts.push(`${this.svgDayX(d)},${this.svgTempY(Number(v))}`);
      }
    }
    return pts.join(' ');
  }

  // Build polyline points for humidity
  private buildHumPolyline(slot: 'morning' | 'afternoon'): string {
    const pts: string[] = [];
    for (let d = 1; d <= this.daysInMonth; d++) {
      const v = slot === 'morning' ? this.days[d - 1]?.humidityMorning : this.days[d - 1]?.humidityAfternoon;
      if (v != null && Number.isFinite(Number(v))) {
        pts.push(`${this.svgDayX(d)},${this.svgHumY(Number(v))}`);
      }
    }
    return pts.join(' ');
  }

  // Cached getters for polylines (avoid repeated calls in template)
  get tempAmPts(): string { return this.buildTempPolyline('morning'); }
  get tempPmPts(): string { return this.buildTempPolyline('afternoon'); }
  get humAmPts():  string { return this.buildHumPolyline('morning'); }
  get humPmPts():  string { return this.buildHumPolyline('afternoon'); }

  hasTempPoint(day: number, slot: 'morning' | 'afternoon'): boolean {
    const v = slot === 'morning' ? this.days[day - 1]?.tempMorning : this.days[day - 1]?.tempAfternoon;
    return v != null && Number.isFinite(Number(v));
  }

  hasHumPoint(day: number, slot: 'morning' | 'afternoon'): boolean {
    const v = slot === 'morning' ? this.days[day - 1]?.humidityMorning : this.days[day - 1]?.humidityAfternoon;
    return v != null && Number.isFinite(Number(v));
  }

  getTempPoint(day: number, slot: 'morning' | 'afternoon'): { x: number; y: number } | null {
    const v = slot === 'morning' ? this.days[day - 1]?.tempMorning : this.days[day - 1]?.tempAfternoon;
    if (v == null || !Number.isFinite(Number(v))) return null;
    return { x: this.svgDayX(day), y: this.svgTempY(Number(v)) };
  }

  getHumPoint(day: number, slot: 'morning' | 'afternoon'): { x: number; y: number } | null {
    const v = slot === 'morning' ? this.days[day - 1]?.humidityMorning : this.days[day - 1]?.humidityAfternoon;
    if (v == null || !Number.isFinite(Number(v))) return null;
    return { x: this.svgDayX(day), y: this.svgHumY(Number(v)) };
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  printForm(): void {
    window.print();
  }
}
