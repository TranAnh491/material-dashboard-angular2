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
  columns: string[] = [];            // headers động lấy từ API
  loading = true;
  errorMsg = '';
  GAS_URL = 'https://script.google.com/macros/s/AKfycbxrISpBqE9PQ6ycA-vIXdhAXf2jMtP18DKW5GWSFBYwS_09E9mJQvsnTY9ydx01QSOX/exec';
  isLoggedIn = false;
  username = '';
  password = '';
  loginError = '';

  // Filter
  selectedYear: string = '';
  selectedMonth: string = '';
  years: string[] = [];
  months: string[] = ['1','2','3','4','5','6','7','8','9','10','11','12'];

  // Tên cột năm, tháng (cứ để đúng tên dòng 4 sheet là được)
  yearColumn: string = 'Year';
  monthColumn: string = 'Month';

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.http.get<any>(this.GAS_URL).subscribe({
      next: (resp) => {
        this.columns = resp.headers;        // lấy tiêu đề động từ API (dòng 4 Sheet)
        this.allWorkOrders = resp.data;     // lấy data
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
