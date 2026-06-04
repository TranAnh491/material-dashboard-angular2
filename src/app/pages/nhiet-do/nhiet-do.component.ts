import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import {
  buildNhietDoFactoryGroups,
  NhietDoFactoryGroup,
  NhietDoFormDef,
  NhietDoFormType,
  TEMP_LIMITS_BY_FORM,
  TempChartLimits
} from './nhiet-do.model';
import {
  NhietDoZaloFactory,
  NhietDoZaloSettingsService,
  ZaloLinkRow
} from '../../services/nhiet-do-zalo-settings.service';

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
  readonly svgPadBot = 42;   // chừa chỗ trục ngày + chú thích Sáng/Chiều
  readonly svgXAxisOffset = 10;
  readonly svgLegendOffset = 28;
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
  isExporting = false;
  saveMessage = '';

  showZaloSettings = false;
  zaloSettingsTab: NhietDoZaloFactory = 'ASM1';
  zaloLinks: ZaloLinkRow[] = [];
  zaloSelectedAsm1 = new Set<string>();
  zaloSelectedAsm2 = new Set<string>();
  zaloSettingsEnabledAsm1 = true;
  zaloSettingsEnabledAsm2 = true;
  zaloSettingsLoading = false;
  zaloSettingsSaving = false;

  readonly zaloEscalationIds = ['ASP0119', 'ASP1761', 'ASP0538'];

  years: number[] = [];

  constructor(
    private firestore: AngularFirestore,
    private router: Router,
    private nhietDoZaloSettings: NhietDoZaloSettingsService
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
  get svgXAxisY(): number  { return this.svgHumTop + this.svgHumH + this.svgXAxisOffset; }
  get svgLegendY(): number { return this.svgHumTop + this.svgHumH + this.svgLegendOffset; }
  /** Căn giữa chú thích Sáng/Chiều dưới biểu đồ (tránh chồng số ngày 1–4) */
  get svgLegendX(): number { return this.svgLabelW + this.svgPlotW / 2 - 42; }
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

  async openZaloSettings(factory: NhietDoZaloFactory): Promise<void> {
    this.zaloSettingsTab = factory;
    this.showZaloSettings = true;
    this.zaloSettingsLoading = true;
    try {
      const [links, asm1, asm2] = await Promise.all([
        this.nhietDoZaloSettings.loadZaloLinks(),
        this.nhietDoZaloSettings.loadFactorySettings('ASM1'),
        this.nhietDoZaloSettings.loadFactorySettings('ASM2')
      ]);
      this.zaloLinks = links;
      this.zaloSelectedAsm1 = new Set(asm1.memberIds);
      this.zaloSelectedAsm2 = new Set(asm2.memberIds);
      this.zaloSettingsEnabledAsm1 = asm1.enabled;
      this.zaloSettingsEnabledAsm2 = asm2.enabled;
    } catch (e) {
      console.error('[Nhiệt Độ] load zalo settings:', e);
      this.showExportMessage('Không tải được cài đặt Zalo.', true);
      this.showZaloSettings = false;
    } finally {
      this.zaloSettingsLoading = false;
    }
  }

  closeZaloSettings(): void {
    this.showZaloSettings = false;
  }

  zaloSettingsTabChange(tab: NhietDoZaloFactory): void {
    this.zaloSettingsTab = tab;
  }

  isZaloMemberSelected(memberId: string): boolean {
    const set = this.zaloSettingsTab === 'ASM1' ? this.zaloSelectedAsm1 : this.zaloSelectedAsm2;
    return set.has(memberId);
  }

  toggleZaloMember(memberId: string): void {
    const set = this.zaloSettingsTab === 'ASM1' ? this.zaloSelectedAsm1 : this.zaloSelectedAsm2;
    if (set.has(memberId)) {
      set.delete(memberId);
    } else {
      set.add(memberId);
    }
  }

  get zaloSettingsEnabled(): boolean {
    return this.zaloSettingsTab === 'ASM1' ? this.zaloSettingsEnabledAsm1 : this.zaloSettingsEnabledAsm2;
  }

  set zaloSettingsEnabled(v: boolean) {
    if (this.zaloSettingsTab === 'ASM1') {
      this.zaloSettingsEnabledAsm1 = v;
    } else {
      this.zaloSettingsEnabledAsm2 = v;
    }
  }

  async saveZaloSettings(): Promise<void> {
    this.zaloSettingsSaving = true;
    try {
      await Promise.all([
        this.nhietDoZaloSettings.saveFactorySettings(
          'ASM1',
          [...this.zaloSelectedAsm1],
          this.zaloSettingsEnabledAsm1
        ),
        this.nhietDoZaloSettings.saveFactorySettings(
          'ASM2',
          [...this.zaloSelectedAsm2],
          this.zaloSettingsEnabledAsm2
        )
      ]);
      this.showExportMessage('Đã lưu cài đặt nhắc Zalo.');
      this.closeZaloSettings();
    } catch (e) {
      console.error('[Nhiệt Độ] save zalo settings:', e);
      this.showExportMessage('Lỗi khi lưu cài đặt Zalo.', true);
    } finally {
      this.zaloSettingsSaving = false;
    }
  }

  printForm(): void {
    window.print();
  }

  async downloadJpg(): Promise<void> {
    await this.exportSheet('jpg');
  }

  async downloadPdf(): Promise<void> {
    await this.exportSheet('pdf');
  }

  private exportBaseName(): string {
    const m = String(this.selectedMonth).padStart(2, '0');
    const id = this.activeForm?.id ?? 'form';
    return `NhietDo_${id}_${this.selectedYear}-${m}`;
  }

  private showExportMessage(msg: string, isError = false): void {
    this.saveMessage = msg;
    const ms = isError ? 4500 : 3000;
    setTimeout(() => {
      if (this.saveMessage === msg) this.saveMessage = '';
    }, ms);
  }

  private prepareSheetClone(doc: Document, root: HTMLElement): void {
    root.querySelectorAll('input').forEach(node => {
      const input = node as HTMLInputElement;
      const span = doc.createElement('span');
      span.textContent = input.value || '';
      const isNote = input.classList.contains('cell-input--note');
      span.style.display = 'block';
      span.style.width = '100%';
      span.style.boxSizing = 'border-box';
      span.style.fontFamily = 'Arial, Helvetica, sans-serif';
      span.style.fontSize = isNote ? '7px' : '8.5px';
      span.style.fontWeight = isNote ? '500' : '600';
      span.style.textAlign = isNote ? 'left' : 'center';
      span.style.padding = '0 1px';
      span.style.color = '#000';
      input.replaceWith(span);
    });
    root.querySelectorAll('.no-print').forEach(el => {
      (el as HTMLElement).style.display = 'none';
    });
    root.querySelectorAll('.print-only').forEach(el => {
      (el as HTMLElement).style.display = 'block';
    });
  }

  private async captureSheetCanvas(): Promise<HTMLCanvasElement> {
    const el = document.getElementById('temp-humidity-sheet');
    if (!el) {
      throw new Error('Không tìm thấy biểu mẫu để xuất file.');
    }
    return html2canvas(el, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      width: el.scrollWidth,
      height: el.scrollHeight,
      windowWidth: el.scrollWidth,
      windowHeight: el.scrollHeight,
      onclone: (_clonedDoc, clonedEl) => {
        const root =
          (clonedEl as HTMLElement).id === 'temp-humidity-sheet'
            ? (clonedEl as HTMLElement)
            : ((clonedEl as HTMLElement).querySelector('#temp-humidity-sheet') as HTMLElement | null)
              ?? (clonedEl as HTMLElement);
        this.prepareSheetClone((clonedEl as HTMLElement).ownerDocument ?? document, root);
      }
    });
  }

  private async exportSheet(format: 'pdf' | 'jpg'): Promise<void> {
    if (!this.activeForm || this.isExporting) return;
    this.isExporting = true;
    this.saveMessage = 'Đang tạo file…';
    try {
      const canvas = await this.captureSheetCanvas();
      const fileName = `${this.exportBaseName()}.${format === 'pdf' ? 'pdf' : 'jpg'}`;

      if (format === 'jpg') {
        const link = document.createElement('a');
        link.download = fileName;
        link.href = canvas.toDataURL('image/jpeg', 0.92);
        link.click();
        this.showExportMessage('Đã tải file JPG.');
        return;
      }

      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageW = 297;
      const pageH = 210;
      const imgData = canvas.toDataURL('image/png');
      const imgH = (canvas.height * pageW) / canvas.width;

      if (imgH <= pageH) {
        pdf.addImage(imgData, 'PNG', 0, 0, pageW, imgH);
      } else {
        let offset = 0;
        let page = 0;
        while (offset < imgH) {
          if (page > 0) pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, -offset, pageW, imgH);
          offset += pageH;
          page++;
        }
      }
      pdf.save(fileName);
      this.showExportMessage('Đã tải file PDF.');
    } catch (e) {
      console.error('[Nhiệt Độ] export failed:', e);
      this.showExportMessage('Không tạo được file. Thử lại sau.', true);
    } finally {
      this.isExporting = false;
    }
  }
}
