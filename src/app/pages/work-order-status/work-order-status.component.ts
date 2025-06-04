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
  loading = true;
  errorMsg = '';
  GAS_URL = 'https://script.google.com/macros/s/AKfycbzAkZjhsjdwSok1CfciFAhftU_J2X3ZQs22JLjGAXINds1VxhdXbAtYvPd3Zq3Xl1Kc/exec';

  isLoggedIn = false;
  username = '';
  password = '';
  loginError = '';

  // Filter
  selectedYear: string = '';
  selectedMonth: string = '';
  years: string[] = [];
  months: string[] = ['1','2','3','4','5','6','7','8','9','10','11','12'];

  // Cho edit dòng
  editIndex: number | null = null;

  yearColumn: string = 'Year';
  monthColumn: string = 'Month';

  constructor(private http: HttpClient) {}

  // Hàm check cột Work Order (giữ lại nếu dùng cho HTML)
  isWorkOrder(col: string): boolean {
    return col.trim().toLowerCase() === 'work order';
  }

  ngOnInit(): void {
    this.http.get<any>(this.GAS_URL).subscribe({
      next: (resp) => {
        this.columns = resp.columns || []; // lấy đúng tiêu đề dòng 4
        this.allWorkOrders = resp.data || [];
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

  // Lưu dòng đang sửa
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
    this.editIndex = null; // reset dòng edit khi lọc lại
  }

  openGoogleSheet() {
    window.open('https://docs.google.com/spreadsheets/d/17ZGxD7Ov-u1Yqu76dXtZBCM8F4rKrpYhpcvmSIt0I84/edit#gid=0', '_blank');
  }
}
