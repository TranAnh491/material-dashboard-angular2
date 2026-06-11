import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild
} from '@angular/core';
import Chart from 'chart.js/auto';
import {
  classifyMaterialQuadrant,
  DOI_THRESHOLD,
  MaterialAnalysisRow,
  QUADRANT_COLORS,
  REPORT_SCOPE,
  REPORT_TRACKING_PERIOD,
  SAMPLE_MATERIAL_ANALYSIS,
  TURNOVER_THRESHOLD
} from './report-data';

@Component({
  selector: 'app-report',
  templateUrl: './report.component.html',
  styleUrls: ['./report.component.scss']
})
export class ReportComponent implements AfterViewInit, OnDestroy {
  @ViewChild('turnoverCanvas') turnoverCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('doiCanvas') doiCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('bubbleCanvas') bubbleCanvas?: ElementRef<HTMLCanvasElement>;

  readonly trackingPeriod = REPORT_TRACKING_PERIOD;
  readonly scope = REPORT_SCOPE;

  readonly rows: MaterialAnalysisRow[] = [...SAMPLE_MATERIAL_ANALYSIS].sort(
    (a, b) => b.turnover - a.turnover
  );

  readonly doiRows: MaterialAnalysisRow[] = [...SAMPLE_MATERIAL_ANALYSIS].sort(
    (a, b) => b.doi - a.doi
  );

  get avgTurnover(): number {
    const sum = this.rows.reduce((s, r) => s + r.turnover, 0);
    return sum / Math.max(1, this.rows.length);
  }

  get avgDoi(): number {
    const sum = this.rows.reduce((s, r) => s + r.doi, 0);
    return sum / Math.max(1, this.rows.length);
  }

  readonly topPerformers = this.rows
    .filter(r => classifyMaterialQuadrant(r.turnover, r.doi) === 'excellent')
    .slice(0, 3);

  readonly atRisk = this.rows
    .filter(r => classifyMaterialQuadrant(r.turnover, r.doi) === 'risk')
    .sort((a, b) => b.doi - a.doi)
    .slice(0, 3);

  private turnoverChart: Chart | null = null;
  private doiChart: Chart | null = null;
  private bubbleChart: Chart | null = null;

  ngAfterViewInit(): void {
    setTimeout(() => this.renderCharts(), 0);
  }

  ngOnDestroy(): void {
    this.destroyChart('turnover');
    this.destroyChart('doi');
    this.destroyChart('bubble');
  }

  private destroyChart(which: 'turnover' | 'doi' | 'bubble'): void {
    const key = which === 'turnover' ? 'turnoverChart' : which === 'doi' ? 'doiChart' : 'bubbleChart';
    const chart = this[key];
    if (chart) {
      try {
        chart.destroy();
      } catch {
        /* ignore */
      }
      this[key] = null;
    }
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
    const sorted = [...this.rows].sort((a, b) => a.turnover - b.turnover);
    const labels = sorted.map(r => r.materialCode);
    const values = sorted.map(r => r.turnover);
    const maxVal = Math.max(...values, 1);

    this.turnoverChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Turnover (x)',
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
              label: c => ` ${Number(c.parsed.x).toFixed(2)}x`
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

    const maxInv = Math.max(...this.rows.map(r => r.inventoryValue), 1);
    const bubbleData = this.rows.map(r => {
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
      bubbleData.filter(d => d.quadrant === q).map(({ x, y, r, materialCode }) => ({ x, y, r, materialCode }));

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
      const label = Number.isInteger(raw) ? String(raw) : raw.toFixed(2);
      c.fillText(label, el.x + 4, el.y);
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
      {
        x: chartArea.left,
        y: chartArea.top,
        w: xMid - chartArea.left,
        h: yMid - chartArea.top,
        color: 'rgba(34,197,94,0.08)',
        label: 'Excellent'
      },
      {
        x: xMid,
        y: chartArea.top,
        w: chartArea.right - xMid,
        h: yMid - chartArea.top,
        color: 'rgba(59,130,246,0.08)',
        label: 'Monitor'
      },
      {
        x: chartArea.left,
        y: yMid,
        w: xMid - chartArea.left,
        h: chartArea.bottom - yMid,
        color: 'rgba(245,158,11,0.08)',
        label: 'Good Potential'
      },
      {
        x: xMid,
        y: yMid,
        w: chartArea.right - xMid,
        h: chartArea.bottom - yMid,
        color: 'rgba(239,68,68,0.08)',
        label: 'At Risk'
      }
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
