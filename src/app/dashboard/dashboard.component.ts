import { Component, OnInit, OnDestroy } from '@angular/core';
import * as Chartist from 'chartist';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {

  workOrder = "...";
  shipment = "...";
  workOrderStatus: any[] = [];

  refreshInterval: any;
  refreshTime = 300000; // 5 phút (300.000 ms)

  constructor() { }

  // Vẽ số lên chart (Line)
  addValueLabels(chart, values) {
    chart.on('draw', function (data) {
      if (data.type === 'point') {
        chart.svg.elem('text', {
          x: data.x,
          y: data.y - 10,
          style: 'font-size: 12px; fill: #333; font-weight: bold;',
        }, 'ct-value').text(values[data.index].toString());
      }
    });
  }

  startAnimationForLineChart(chart) {
    let seq: any, delays: any, durations: any;
    seq = 0; delays = 80; durations = 500;
    chart.on('draw', function (data) {
      if (data.type === 'line' || data.type === 'area') {
        data.element.animate({
          d: {
            begin: 600,
            dur: 700,
            from: data.path.clone().scale(1, 0).translate(0, data.chartRect.height()).stringify(),
            to: data.path.clone().stringify(),
            easing: Chartist.Svg.Easing.easeOutQuint
          }
        });
      } else if (data.type === 'point') {
        seq++;
        data.element.animate({
          opacity: {
            begin: seq * delays,
            dur: durations,
            from: 0,
            to: 1,
            easing: 'ease'
          }
        });
      }
    });
    seq = 0;
  }

  startAnimationForBarChart(chart) {
    let seq2: any, delays2: any, durations2: any;
    seq2 = 0; delays2 = 80; durations2 = 500;
    chart.on('draw', function (data) {
      if (data.type === 'bar') {
        seq2++;
        data.element.animate({
          opacity: {
            begin: seq2 * delays2,
            dur: durations2,
            from: 0,
            to: 1,
            easing: 'ease'
          }
        });
      }
    });
    seq2 = 0;
  }

  ngOnInit() {
    this.loadDashboardData();
    // Tự động reload mỗi 5 phút
    this.refreshInterval = setInterval(() => {
      this.loadDashboardData();
    }, this.refreshTime);
  }

  ngOnDestroy() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  loadDashboardData() {
    fetch('https://docs.google.com/spreadsheets/d/1dGfJhDx-JNsFJ0l3kcz8uAHvMtm7GhPeAcUj8pBqx_Q/pub?gid=1580861382&single=true&output=csv')
      .then(res => res.text())
      .then(csv => {
        const rows = csv.split('\n').map(row => row.split(','));

        // Lấy số Work order & Shipment
        for (let cells of rows) {
          if (cells[0]?.trim().toLowerCase() === "work order") this.workOrder = cells[1]?.trim();
          if (cells[0]?.trim().toLowerCase() === "shipment") this.shipment = cells[1]?.trim();
        }

        // Biểu đồ (dữ liệu giả định như cũ)
        const months = rows[11].slice(1).map(m => m.trim());
        const matAccuracy = rows[12].slice(1).map(a => Number(a.replace('%','').replace(',','.').trim())).filter(x => !isNaN(x));
        const fgAccuracy = rows[13].slice(1).map(a => Number(a.replace('%','').replace(',','.').trim())).filter(x => !isNaN(x));
        const fgTurnover = rows[14].slice(1).map(a => Number(a.replace(',','.').trim())).filter(x => !isNaN(x));

        // Chart 1: Materials Accuracy (Line)
        let matMin = Math.min(...matAccuracy);
        let matMax = Math.max(...matAccuracy);
        const optionsMaterialsAccuracy = {
          lineSmooth: Chartist.Interpolation.cardinal({ tension: 0 }),
          low: Math.max(98, matMin - 0.2),
          high: Math.min(100, matMax + 0.2),
          chartPadding: { top: 20, right: 10, bottom: 0, left: 10 }
        };
        const dataMaterialsAccuracy = {
          labels: months,
          series: [matAccuracy]
        };
        const dailySalesChart = new Chartist.Line('#dailySalesChart', dataMaterialsAccuracy, optionsMaterialsAccuracy);
        this.startAnimationForLineChart(dailySalesChart);
        this.addValueLabels(dailySalesChart, matAccuracy);

        // Chart 2: Finished Goods Accuracy (Line)
        let fgMin = Math.min(...fgAccuracy);
        let fgMax = Math.max(...fgAccuracy);
        const optionsFGAccuracy = {
          lineSmooth: Chartist.Interpolation.cardinal({ tension: 0 }),
          low: Math.max(98, fgMin - 0.2),
          high: Math.min(100, fgMax + 0.2),
          chartPadding: { top: 20, right: 10, bottom: 0, left: 10 }
        };
        const dataFGAccuracy = {
          labels: months,
          series: [fgAccuracy]
        };
        const websiteViewsChart = new Chartist.Line('#websiteViewsChart', dataFGAccuracy, optionsFGAccuracy);
        this.startAnimationForLineChart(websiteViewsChart);
        this.addValueLabels(websiteViewsChart, fgAccuracy);

        // Chart 3: FGs Inventory Turnover (Line)
        let fgTMin = Math.min(...fgTurnover);
        let fgTMax = Math.max(...fgTurnover);
        const optionsFGTurnover = {
          lineSmooth: Chartist.Interpolation.cardinal({ tension: 0 }),
          low: Math.floor(fgTMin - 0.2),
          high: fgTMax + 0.2,
          chartPadding: { top: 20, right: 10, bottom: 0, left: 10 }
        };
        const dataFGTurnover = {
          labels: months,
          series: [fgTurnover]
        };
        const completedTasksChart = new Chartist.Line('#completedTasksChart', dataFGTurnover, optionsFGTurnover);
        this.startAnimationForLineChart(completedTasksChart);
        this.addValueLabels(completedTasksChart, fgTurnover);

        // Dữ liệu workOrderStatus (A19:C25, dòng 18-24)
        this.workOrderStatus = [];
        for (let i = 19; i <= 24; i++) {
          if (rows[i] && rows[i][0]) {
            this.workOrderStatus.push({
              code: rows[i][0]?.trim(),
              value: rows[i][1] ? rows[i][1].trim() : '',
              note: rows[i][2] ? rows[i][2].trim() : '',
              extra: rows[i][3] ? rows[i][3].trim() : ''
            });
          }
        }
      });
  }
}
