import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-work-order-status',
  templateUrl: './work-order-status.component.html',
  styleUrls: ['./work-order-status.component.scss']
})
export class WorkOrderStatusComponent implements OnInit {
  workOrders: any[] = [];            // data sau khi lọc
  allWorkOrders: any[] = [];         // full data lấy từ sheet
  columns: string[] = [];
  loading = true;
  errorMsg = '';
  GAS_URL = 'https://script.google.com/macros/s/AKfycbyM1qg6foGjZdr-y1f8ZiKJ8N-x5FU2VunC6Z_JsYBLsWR13V4fm_j0Z7sahKxCdvKX/exec';
  isLoggedIn = false;
  username = '';
  password = '';
  loginError = '';

  // Filter
  selectedYear: string = '';
  selectedMonth: string = '';
  years: string[] = [];
  months: string[] = ['1','2','3','4','5','6','7','8','9','10','11','12'];

  // Đúng tên cột lấy từ Google Sheet
  yearColumn: string = 'NĂM';    // Đúng tên cột A (thường là 'NĂM' hoặc 'NAM')
  monthColumn: string = 'THÁNG'; // Đúng tên cột B (thường là 'THÁNG' hoặc 'THANG')

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.http.get<any[]>(this.GAS_URL).subscribe({
      next: (data) => {
        if (data.length) this.columns = Object.keys(data[0]);
        this.allWorkOrders = data;
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
    // Tìm index gốc của dòng đang hiển thị trong allWorkOrders
    const idx = this.allWorkOrders.findIndex(row =>
      this.columns.every(col => row[col] === data[col])
    );
    this.http.post<any>(this.GAS_URL, {row: idx, data}).subscribe({
      next: () => alert('Saved!'),
      error: () => alert('Save failed!')
    });
  }

  getYearsList(): string[] {
    const yearSet = new Set<string>();
    for (const row of this.allWorkOrders) {
      if (row[this.yearColumn]) yearSet.add(row[this.yearColumn].toString());
    }
    // Sắp xếp tăng dần
    return Array.from(yearSet).sort((a,b) => Number(a) - Number(b));
  }

  filterData() {
    this.workOrders = this.allWorkOrders.filter(row => {
      let ok = true;
      if (this.selectedYear) ok = ok && row[this.yearColumn]?.toString() === this.selectedYear;
      if (this.selectedMonth) ok = ok && row[this.monthColumn]?.toString() === this.selectedMonth;
      return ok;
    });
  }
}
