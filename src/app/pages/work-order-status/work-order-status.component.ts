import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-work-order-status',
  templateUrl: './work-order-status.component.html',
  styleUrls: ['./work-order-status.component.scss']
})
export class WorkOrderStatusComponent implements OnInit {
  workOrders: any[] = [];
  allWorkOrders: any[] = [];
  columns: string[] = [];
  options: any = {};
  loading = true;
  errorMsg = '';
  GAS_URL = 'https://script.google.com/macros/s/AKfycbxlZrZenHAm-9Qp5LrwPvtvFb7e5qqMlXJTqR0Mtq7kp6r8UED6Ouh7DE8-cdn5WMlW/exec';

  isLoggedIn = false;
  username = '';
  password = '';
  loginError = '';

  selectedYear: string = '';
  selectedMonth: string = '';
  years: string[] = [];
  months: string[] = ['1','2','3','4','5','6','7','8','9','10','11','12'];

  editIndex: number | null = null;

  yearColumn: string = '';  // sẽ tự động lấy khi load data
  monthColumn: string = '';

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.http.get<any>(this.GAS_URL).subscribe({
      next: (resp) => {
        this.columns = resp.columns;
        this.allWorkOrders = resp.data;
        this.options = resp.options || {};

        // Tự xác định tên cột year/month dựa trên tên tiêu đề
        this.yearColumn = this.columns.find(h => h.toLowerCase().includes('year')) || '';
        this.monthColumn = this.columns.find(h => h.toLowerCase().includes('month')) || '';

        this.years = this.getYearsList();
        this.filterData();
        this.loading = false;
      },
      error: () => {
        this.errorMsg = 'Failed to load data';
        this.loading = false;
      }
    });
  }

  login() {
    if (this.username === 'Admin' && this.password === 'admin') {
      this.isLoggedIn = true;
      this.loginError = '';
    } else {
      this.loginError = 'Wrong account or password!';
    }
  }

  saveRow(i: number) {
    const data = this.workOrders[i];
    const idx = this.allWorkOrders.findIndex(row =>
      this.columns.every(col => row[col] === data[col])
    );
    this.http.post<any>(this.GAS_URL, {row: idx, data}).subscribe({
      next: () => {
        alert('Saved!');
        this.editIndex = null;
      },
      error: () => alert('Save failed!')
    });
  }

  getYearsList(): string[] {
    const yearSet = new Set<string>();
    for (const row of this.allWorkOrders) {
      if (row[this.yearColumn]) yearSet.add(row[this.yearColumn].toString());
    }
    return Array.from(yearSet).sort((a, b) => Number(a) - Number(b));
  }

  filterData() {
    this.workOrders = this.allWorkOrders.filter(row => {
      let ok = true;
      if (this.selectedYear) ok = ok && row[this.yearColumn]?.toString() === this.selectedYear;
      if (this.selectedMonth) ok = ok && row[this.monthColumn]?.toString() === this.selectedMonth;
      return ok;
    });
    this.editIndex = null;
  }
}
