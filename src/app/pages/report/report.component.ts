import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild
} from '@angular/core';
import { Router } from '@angular/router';
import Chart from 'chart.js/auto';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import * as XLSX from 'xlsx';
import {
  buildMaterialToProductMap,
  classifyMaterialQuadrant,
  DOI_THRESHOLD,
  MaterialAnalysisRow,
  MATERIALS_BCTK_SHEET_HINT,
  normalizeExcelHeader,
  normalizeStoredMaterialsUsd,
  parseReportWorkbook,
  reapplyMaterialCustomers,
  REPORT_USD_RATE,
  QUADRANT_COLORS,
  ReportDataType,
  ReportImportResult,
  ReportSnapshot,
  SAMPLE_FG_ANALYSIS,
  SAMPLE_MATERIAL_ANALYSIS,
  TURNOVER_THRESHOLD
} from './report-data';
import { ReportDmtpService } from './report-dmtp.service';
import { VietcombankRateService } from './vietcombank-rate.service';

@Component({
  selector: 'app-report',
  templateUrl: './report.component.html',
  styleUrls: ['./report.component.scss']
})
export class ReportComponent implements AfterViewInit, OnDestroy {
  @ViewChild('turnoverCanvas') turnoverCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('doiCanvas') doiCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('bubbleCanvas') bubbleCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;

  // ── Data type toggle ────────────────────────────────────────────────────
  dataType: ReportDataType = 'materials';

  activeRows: MaterialAnalysisRow[] = [];
  isLoading = false;
  trackingPeriod = 'Sample Data';
  lastUpdated: Date | null = null;
  usdRateUsed: number | null = null;

  get scope(): string {
    return this.dataType === 'materials'
      ? `${this.activeRows.length} Materials`
      : `${this.activeRows.length} Finished Goods`;
  }

  /** Materials mới import: chỉ có giá trị tồn, chưa có turnover. */
  get usesInventoryValueMode(): boolean {
    return this.dataType === 'materials'
      && this.activeRows.length > 0
      && this.activeRows.every(r => !r.turnover && r.inventoryValue > 0);
  }

  /** Top 20 cho bảng Code / Customer (luôn đồng bộ thứ tự giá trị tồn). */
  get tableRows(): MaterialAnalysisRow[] {
    if (this.dataType === 'materials' && this.activeRows.length) {
      return [...this.activeRows].sort((a, b) => b.inventoryValue - a.inventoryValue);
    }
    return [...this.activeRows].sort((a, b) => b.turnover - a.turnover);
  }

  get rows(): MaterialAnalysisRow[] {
    if (this.usesInventoryValueMode) {
      return this.tableRows;
    }
    return [...this.activeRows].sort((a, b) => b.turnover - a.turnover);
  }

  get doiRows(): MaterialAnalysisRow[] {
    return [...this.activeRows].sort((a, b) => b.doi - a.doi);
  }

  get avgTurnover(): number {
    const sum = this.activeRows.reduce((s, r) => s + r.turnover, 0);
    return sum / Math.max(1, this.activeRows.length);
  }

  get avgDoi(): number {
    const sum = this.activeRows.reduce((s, r) => s + r.doi, 0);
    return sum / Math.max(1, this.activeRows.length);
  }

  get topPerformers(): MaterialAnalysisRow[] {
    return this.rows
      .filter(r => classifyMaterialQuadrant(r.turnover, r.doi) === 'excellent')
      .slice(0, 3);
  }

  get atRisk(): MaterialAnalysisRow[] {
    return this.rows
      .filter(r => classifyMaterialQuadrant(r.turnover, r.doi) === 'risk')
      .sort((a, b) => b.doi - a.doi)
      .slice(0, 3);
  }

  // ── Import modal ────────────────────────────────────────────────────────
  showImportModal = false;
  importPeriod = '';
  importLoading = false;
  importError = '';
  importSuccess = false;
  importFileName = '';
  parsedImport: ReportImportResult | null = null;
  importLookupStats = { dmtp: 0, xuat: 0 };
  private pendingWorkbook: XLSX.WorkBook | null = null;

  private turnoverChart: Chart | null = null;
  private doiChart: Chart | null = null;
  private bubbleChart: Chart | null = null;
  private chartsReady = false;

  constructor(
    private firestore: AngularFirestore,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private vcbRate: VietcombankRateService,
    private reportDmtp: ReportDmtpService
  ) {}

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  countCustomers(rows: MaterialAnalysisRow[]): number {
    return rows.filter((r) => r.customer && r.customer !== 'N/A').length;
  }

  ngAfterViewInit(): void {
    this.chartsReady = true;
    this.loadData(this.dataType);
  }

  ngOnDestroy(): void {
    this.destroyChart('turnover');
    this.destroyChart('doi');
    this.destroyChart('bubble');
  }

  // ── Type toggle ─────────────────────────────────────────────────────────
  setDataType(type: ReportDataType): void {
    if (this.dataType === type) return;
    this.dataType = type;
    this.loadData(type);
  }

  // ── Load from Firestore ─────────────────────────────────────────────────
  private loadData(type: ReportDataType): void {
    this.isLoading = true;
    this.cdr.markForCheck();

    this.firestore
      .collection('report-data')
      .doc<ReportSnapshot>(type)
      .get()
      .subscribe(
        async (snap) => {
          try {
            if (snap.exists) {
              const data = snap.data() as ReportSnapshot;
              const rate = data.usdRate ?? (type === 'materials' ? REPORT_USD_RATE : 0);
              let rows = (data.rows || []).filter(r => r.materialCode);
              if (type === 'materials' && rate) {
                rows = normalizeStoredMaterialsUsd(rows, rate);
              }
              if (type === 'materials' && rows.length) {
                const [dmtpMap, xuatMap] = await Promise.all([
                  this.reportDmtp.loadDmtpCustomerMap(),
                  this.reportDmtp.loadXuatMaterialProductMap()
                ]);
                if (dmtpMap.size || xuatMap.size) {
                  rows = reapplyMaterialCustomers(rows, xuatMap, dmtpMap);
                }
              }
              this.activeRows = rows;
              this.trackingPeriod = data.period || '—';
              this.lastUpdated = data.updatedAt?.toDate?.() ?? null;
              this.usdRateUsed = rate || null;
            } else {
              this.activeRows =
                type === 'materials'
                  ? [...SAMPLE_MATERIAL_ANALYSIS]
                  : [...SAMPLE_FG_ANALYSIS];
              this.trackingPeriod = 'Sample Data';
              this.lastUpdated = null;
              this.usdRateUsed = null;
            }
          } catch (err) {
            console.error('Error loading report data:', err);
            this.activeRows =
              type === 'materials'
                ? [...SAMPLE_MATERIAL_ANALYSIS]
                : [...SAMPLE_FG_ANALYSIS];
            this.trackingPeriod = 'Sample Data';
            this.usdRateUsed = null;
          }
          this.isLoading = false;
          this.cdr.detectChanges();
          if (this.chartsReady) {
            setTimeout(() => this.renderCharts(), 0);
          }
        },
        (err) => {
          console.error('Error loading report data:', err);
          this.activeRows =
            type === 'materials'
              ? [...SAMPLE_MATERIAL_ANALYSIS]
              : [...SAMPLE_FG_ANALYSIS];
          this.trackingPeriod = 'Sample Data';
          this.usdRateUsed = null;
          this.isLoading = false;
          this.cdr.detectChanges();
          if (this.chartsReady) {
            setTimeout(() => this.renderCharts(), 0);
          }
        }
      );
  }

  // ── Import modal helpers ────────────────────────────────────────────────
  openImportModal(): void {
    this.importPeriod = '';
    this.importError = '';
    this.importSuccess = false;
    this.importFileName = '';
    this.parsedImport = null;
    this.pendingWorkbook = null;
    this.importLookupStats = { dmtp: 0, xuat: 0 };
    this.showImportModal = true;
  }

  closeImportModal(): void {
    if (this.importLoading) return;
    this.showImportModal = false;
    if (this.fileInputRef?.nativeElement) {
      this.fileInputRef.nativeElement.value = '';
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.importError = '';
    this.importFileName = file.name;
    this.parsedImport = null;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });

        if (!workbook.SheetNames?.length) {
          this.importError = 'File trống hoặc không đọc được.';
          this.cdr.markForCheck();
          return;
        }

        this.importLoading = true;
        this.cdr.markForCheck();

        this.pendingWorkbook = workbook;
        const usdRate = await this.vcbRate.getLatestUsdTransferRate();
        const [dmtpMap, xuatFromFirebase] = await Promise.all([
          this.reportDmtp.loadDmtpCustomerMap(),
          this.reportDmtp.loadXuatMaterialProductMap()
        ]);
        const xuatFromFile = buildMaterialToProductMap(workbook);
        const xuatMerged = new Map(xuatFromFirebase);
        xuatFromFile.forEach((v, k) => xuatMerged.set(k, v));
        this.importLookupStats = { dmtp: dmtpMap.size, xuat: xuatMerged.size };
        this.parsedImport = parseReportWorkbook(workbook, usdRate, dmtpMap, xuatMerged);

        const hasBctkSheet = workbook.SheetNames.some((name) => {
          const key = normalizeExcelHeader(name);
          const hint = normalizeExcelHeader(MATERIALS_BCTK_SHEET_HINT);
          return key === hint || key.includes(hint) || (key.includes('bctk') && key.includes('nvl'));
        });
        if (!hasBctkSheet) {
          this.importError = `Không tìm thấy sheet "${MATERIALS_BCTK_SHEET_HINT}" trong file.`;
        } else if (!this.parsedImport.materials.length) {
          this.importError =
            'Không đọc được Materials. Kiểm tra cột Mã hàng/Mã NVL và Số dư cuối kỳ trên sheet BCTK NVL.';
        } else {
          this.importError = '';
        }
        this.importLoading = false;
        this.cdr.markForCheck();
      } catch (err) {
        console.error('Parse error:', err);
        this.importError = 'Lỗi đọc file. Vui lòng dùng định dạng .xlsx hoặc .csv.';
        this.importLoading = false;
        this.cdr.markForCheck();
      }
    };
    reader.readAsArrayBuffer(file);
  }

  confirmImport(): void {
    if (!this.parsedImport) {
      this.importError = 'Chưa chọn file hoặc file không đọc được.';
      return;
    }
    if (!this.parsedImport.materials.length) {
      this.importError = 'Không có dữ liệu Materials hợp lệ để lưu.';
      return;
    }

    this.importLoading = true;
    this.importError = '';
    this.cdr.markForCheck();

    const period = this.importPeriod.trim() || new Date().toLocaleDateString('vi-VN');
    const updatedAt = new Date();
    const materialsSnapshot: ReportSnapshot = {
      type: 'materials',
      period,
      updatedAt,
      rows: this.parsedImport.materials,
      usdRate: this.parsedImport.usdRate
    };
    const fgsSnapshot: ReportSnapshot = {
      type: 'fgs',
      period,
      updatedAt,
      rows: this.parsedImport.fgs,
      usdRate: this.parsedImport.usdRate
    };

    const workbook = this.pendingWorkbook;
    const xuatMap = workbook ? buildMaterialToProductMap(workbook) : new Map();

    Promise.all([
      this.firestore.collection('report-data').doc('materials').set(materialsSnapshot),
      this.firestore.collection('report-data').doc('fgs').set(fgsSnapshot),
      workbook ? this.reportDmtp.saveDmtpFromWorkbook(workbook) : Promise.resolve(),
      xuatMap.size ? this.reportDmtp.saveXuatMaterialProductMap(xuatMap) : Promise.resolve()
    ])
      .then(() => {
        this.importLoading = false;
        this.importSuccess = true;
        this.cdr.markForCheck();
        this.loadData(this.dataType);
        setTimeout(() => this.closeImportModal(), 1800);
      })
      .catch((err) => {
        console.error('Firestore write error:', err);
        this.importError = 'Lưu dữ liệu thất bại. Kiểm tra quyền Firestore.';
        this.importLoading = false;
        this.cdr.markForCheck();
      });
  }

  // ── Chart rendering ─────────────────────────────────────────────────────
  private destroyChart(which: 'turnover' | 'doi' | 'bubble'): void {
    const chart =
      which === 'turnover' ? this.turnoverChart : which === 'doi' ? this.doiChart : this.bubbleChart;
    if (chart) {
      try { chart.destroy(); } catch {}
    }
    if (which === 'turnover') this.turnoverChart = null;
    else if (which === 'doi') this.doiChart = null;
    else this.bubbleChart = null;
  }

  private renderCharts(): void {
    this.renderTurnoverChart();
    this.renderDoiChart();
    this.renderBubbleChart();
  }

  private renderTurnoverChart(): void {
    const canvas = this.turnoverCanvas?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    this.destroyChart('turnover');
    const useInventory = this.usesInventoryValueMode;
    const sorted = [...this.rows].sort((a, b) =>
      useInventory ? a.inventoryValue - b.inventoryValue : a.turnover - b.turnover
    );
    const labels = sorted.map(r => r.materialCode);
    const values = sorted.map(r => (useInventory ? r.inventoryValue : r.turnover));
    const maxVal = Math.max(...values, 1);

    this.turnoverChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: useInventory ? 'Inventory Value' : 'Turnover (x)',
            data: values,
            backgroundColor: '#1e3a5f',
            borderRadius: 2,
            barThickness: 14
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 48 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: c => useInventory
                ? ` $${Number(c.parsed.x).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
                : ` ${Number(c.parsed.x).toFixed(2)}x`
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            suggestedMax: maxVal * 1.08,
            grid: { color: 'rgba(15,23,42,0.08)' },
            ticks: { font: { size: 10 } }
          },
          y: {
            grid: { display: false },
            ticks: { font: { size: 9 } }
          }
        }
      },
      plugins: [
        {
          id: 'turnoverBarLabels',
          afterDatasetsDraw: chart => this.drawHorizontalBarValues(chart, 0)
        }
      ]
    });
  }

  private renderDoiChart(): void {
    const canvas = this.doiCanvas?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    this.destroyChart('doi');
    const sorted = [...this.doiRows].sort((a, b) => a.doi - b.doi);
    const labels = sorted.map(r => r.materialCode);
    const values = sorted.map(r => r.doi);
    const maxVal = Math.max(...values, 1);

    this.doiChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'DOI (Days)',
            data: values,
            backgroundColor: '#166534',
            borderRadius: 2,
            barThickness: 14
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 36 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: c => ` ${c.parsed.x} days`
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            suggestedMax: maxVal * 1.1,
            grid: { color: 'rgba(15,23,42,0.08)' },
            ticks: { font: { size: 10 } }
          },
          y: {
            grid: { display: false },
            ticks: { font: { size: 9 } }
          }
        }
      },
      plugins: [
        {
          id: 'doiBarLabels',
          afterDatasetsDraw: chart => this.drawHorizontalBarValues(chart, 0)
        }
      ]
    });
  }

  private renderBubbleChart(): void {
    const canvas = this.bubbleCanvas?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    this.destroyChart('bubble');

    const maxInv = Math.max(...this.activeRows.map(r => r.inventoryValue), 1);
    const bubbleData = this.activeRows.map(r => {
      const q = classifyMaterialQuadrant(r.turnover, r.doi);
      return {
        x: Math.max(1, r.doi),
        y: Math.max(1, r.turnover),
        r: 6 + (r.inventoryValue / maxInv) * 18,
        materialCode: r.materialCode,
        quadrant: q
      };
    });

    const byQuadrant = (q: string) =>
      bubbleData
        .filter(d => d.quadrant === q)
        .map(({ x, y, r, materialCode }) => ({ x, y, r, materialCode }));

    this.bubbleChart = new Chart(ctx, {
      type: 'bubble',
      data: {
        datasets: [
          {
            label: 'Excellent',
            data: byQuadrant('excellent'),
            backgroundColor: QUADRANT_COLORS.excellent + 'cc',
            borderColor: QUADRANT_COLORS.excellent,
            borderWidth: 1
          },
          {
            label: 'Monitor',
            data: byQuadrant('monitor'),
            backgroundColor: QUADRANT_COLORS.monitor + 'cc',
            borderColor: QUADRANT_COLORS.monitor,
            borderWidth: 1
          },
          {
            label: 'Good Potential',
            data: byQuadrant('potential'),
            backgroundColor: QUADRANT_COLORS.potential + 'cc',
            borderColor: QUADRANT_COLORS.potential,
            borderWidth: 1
          },
          {
            label: 'At Risk',
            data: byQuadrant('risk'),
            backgroundColor: QUADRANT_COLORS.risk + 'cc',
            borderColor: QUADRANT_COLORS.risk,
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 10, font: { size: 10 } }
          },
          tooltip: {
            callbacks: {
              label: ctx => {
                const raw = ctx.raw as { materialCode?: string; x: number; y: number };
                return ` ${raw.materialCode}: DOI ${raw.x}, Turnover ${raw.y.toFixed(1)}x`;
              }
            }
          }
        },
        scales: {
          x: {
            type: 'logarithmic',
            min: 1,
            max: 1000,
            title: {
              display: true,
              text: 'DOI (Days)',
              font: { size: 11, weight: 'bold' }
            },
            grid: { color: 'rgba(15,23,42,0.06)' },
            ticks: { font: { size: 9 } }
          },
          y: {
            type: 'logarithmic',
            min: 1,
            max: 1000,
            title: {
              display: true,
              text: 'Turnover (x)',
              font: { size: 11, weight: 'bold' }
            },
            grid: { color: 'rgba(15,23,42,0.06)' },
            ticks: { font: { size: 9 } }
          }
        }
      },
      plugins: [
        {
          id: 'bubbleQuadrants',
          beforeDatasetsDraw: chart => this.drawQuadrantBackground(chart)
        },
        {
          id: 'bubbleLabels',
          afterDatasetsDraw: chart => this.drawBubbleMaterialLabels(chart)
        }
      ]
    });
  }

  private formatBarValue(raw: number): string {
    if (this.usesInventoryValueMode) {
      if (raw >= 1_000_000) return `$${(raw / 1_000_000).toFixed(1)}M`;
      if (raw >= 1_000) return `$${(raw / 1_000).toFixed(1)}K`;
      return `$${raw.toFixed(0)}`;
    }
    return Number.isInteger(raw) ? String(raw) : raw.toFixed(2);
  }

  private drawHorizontalBarValues(chart: Chart, datasetIndex: number): void {
    const ds = chart.data.datasets[datasetIndex];
    const meta = chart.getDatasetMeta(datasetIndex);
    if (!ds || !meta?.data?.length) return;
    const c = chart.ctx;
    c.save();
    c.fillStyle = '#0f172a';
    c.font = 'bold 9px Inter, system-ui, sans-serif';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    meta.data.forEach((elem, i) => {
      const raw = ds.data[i];
      if (typeof raw !== 'number') return;
      const el = elem as { x?: number; y?: number };
      if (el.x == null || el.y == null) return;
      c.fillText(this.formatBarValue(raw), el.x + 4, el.y);
    });
    c.restore();
  }

  private drawQuadrantBackground(chart: Chart): void {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;

    const xScale = scales.x;
    const yScale = scales.y;
    const xMid = xScale.getPixelForValue(DOI_THRESHOLD);
    const yMid = yScale.getPixelForValue(TURNOVER_THRESHOLD);

    const regions: Array<{ x: number; y: number; w: number; h: number; color: string; label: string }> = [
      { x: chartArea.left, y: chartArea.top, w: xMid - chartArea.left, h: yMid - chartArea.top, color: 'rgba(34,197,94,0.08)', label: 'Excellent' },
      { x: xMid, y: chartArea.top, w: chartArea.right - xMid, h: yMid - chartArea.top, color: 'rgba(59,130,246,0.08)', label: 'Monitor' },
      { x: chartArea.left, y: yMid, w: xMid - chartArea.left, h: chartArea.bottom - yMid, color: 'rgba(245,158,11,0.08)', label: 'Good Potential' },
      { x: xMid, y: yMid, w: chartArea.right - xMid, h: chartArea.bottom - yMid, color: 'rgba(239,68,68,0.08)', label: 'At Risk' }
    ];

    ctx.save();
    for (const r of regions) {
      ctx.fillStyle = r.color;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = 'rgba(15,23,42,0.35)';
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(r.label, r.x + r.w / 2, r.y + r.h / 2);
    }

    ctx.strokeStyle = 'rgba(100,116,139,0.55)';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xMid, chartArea.top);
    ctx.lineTo(xMid, chartArea.bottom);
    ctx.moveTo(chartArea.left, yMid);
    ctx.lineTo(chartArea.right, yMid);
    ctx.stroke();
    ctx.restore();
  }

  private drawBubbleMaterialLabels(chart: Chart): void {
    const c = chart.ctx;
    c.save();
    c.font = 'bold 8px Inter, system-ui, sans-serif';
    c.fillStyle = '#0f172a';
    c.textAlign = 'center';
    c.textBaseline = 'bottom';

    for (const dataset of chart.data.datasets) {
      const meta = chart.getDatasetMeta(chart.data.datasets.indexOf(dataset));
      meta.data.forEach((elem, i) => {
        const raw = dataset.data[i] as { materialCode?: string };
        const el = elem as { x?: number; y?: number };
        if (!raw?.materialCode || el.x == null || el.y == null) return;
        c.fillText(raw.materialCode, el.x, el.y - (raw as { r?: number }).r! - 2);
      });
    }
    c.restore();
  }
}
