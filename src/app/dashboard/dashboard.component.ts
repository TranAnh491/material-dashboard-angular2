import { Component, OnInit, OnDestroy } from '@angular/core';
import Chart from 'chart.js/auto';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {

  workOrder = "...";
  shipment = "...";
  workOrderStatus: any[] = [];
  shipmentStatus: any[] = [];

  refreshInterval: any;
  refreshTime = 300000; // 5 phút

  constructor() { }

  ngOnInit() {
    this.loadDashboardData();
    this.refreshInterval = setInterval(() => this.loadDashboardData(), this.refreshTime);
  }

  ngOnDestroy() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  createChart(canvasId: string, label: string, labels: string[], data: number[], color: string) {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label,
          data,
          borderColor: color,
          backgroundColor: color + '33',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#fff',
          pointBorderColor: color,
          borderWidth: 2
        }]
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.dataset.label}: ${context.raw}`
            }
          }
        },
        responsive: true,
        scales: {
          y: { beginAtZero: false }
        }
      }
    });
  }

  loadDashboardData() {
    fetch('https://docs.google.com/spreadsheets/d/1dGfJhDx-JNsFJ0l3kcz8uAHvMtm7GhPeAcUj8pBqx_Q/pub?gid=1580861382&single=true&output=csv')
      .then(res => res.text())
      .then(csv => {
        const rows = csv.split('\n').map(row => row.split(','));

        for (let cells of rows) {
          if (cells[0]?.trim().toLowerCase() === "work order") this.workOrder = cells[1]?.trim();
          if (cells[0]?.trim().toLowerCase() === "shipment") this.shipment = cells[1]?.trim();
        }

        const months = rows[11].slice(1).map(m => m.trim());
        const matAccuracy = rows[12].slice(1).map(a => Number(a.replace('%', '').replace(',', '.').trim())).filter(x => !isNaN(x));
        const fgAccuracy = rows[13].slice(1).map(a => Number(a.replace('%', '').replace(',', '.').trim())).filter(x => !isNaN(x));
        const fgTurnover = rows[14].slice(1).map(a => Number(a.replace(',', '.').trim())).filter(x => !isNaN(x));

        this.createChart('dailySalesChart', '% Materials Accuracy', months, matAccuracy, '#4caf50');
        this.createChart('websiteViewsChart', '% Finished Goods Accuracy', months, fgAccuracy, '#ff9800');
        this.createChart('completedTasksChart', 'Inventory Turnover', months, fgTurnover, '#2196f3');

        // Work Order Status
        this.workOrderStatus = [];
        for (let i = 19; i <= 24; i++) {
          if (rows[i] && rows[i][0] && rows[i][0].trim().toLowerCase() !== 'date') {
            this.workOrderStatus.push({
              code: rows[i][0]?.trim(),
              value: rows[i][1]?.trim() || '',
              note: rows[i][2]?.trim() || '',
              ready: rows[i][3]?.trim() || '',
              extra: rows[i][4]?.trim() || ''
            });
          }
        }

        // Shipment Status
        this.shipmentStatus = [];
        for (let i = 31; i < rows.length; i++) {
          if (!rows[i] || !rows[i][0] || rows[i][0].trim() === '') break;
          if (rows[i][0].trim().toLowerCase() === 'ship date') continue;

          this.shipmentStatus.push({
            shipDate: rows[i][0]?.trim(),
            shipment: rows[i][1]?.trim(),
            customer: rows[i][2]?.trim(),
            carton: rows[i][3]?.trim(),
            statusDetail: rows[i][4]?.trim()
          });
        }
      });
  }
}
