import { Component, OnInit, OnDestroy } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';

@Component({
  selector: 'app-work-order-status',
  templateUrl: './work-order-status.component.html',
  styleUrls: ['./work-order-status.component.scss']
})
export class WorkOrderStatusComponent implements OnInit, OnDestroy {
  workOrders: any[] = [];
  allWorkOrders: any[] = [];
  columns: string[] = [];
  columnOptions: { [key: string]: string[] } = {};
  loading = true;
  errorMsg = '';
  GAS_URL = 'https://script.google.com/macros/s/AKfycbycffWLVmbTSAlnHB8rCci3mAYL45Ehl1TEYJbBrKzZPw86-tkXdU4DRGbCQyDT2j0c/exec';

  isLoggedIn = false;
  username = '';
  password = '';
  loginError = '';

  selectedYear: string = '';
  selectedMonth: string = '';
  years: string[] = [];
  months: string[] = ['1','2','3','4','5','6','7','8','9','10','11','12'];

  editIndex: number | null = null;
  originalRowData: any = null;

  yearColumn: string = 'Year';
  monthColumn: string = 'Month';

  refreshInterval: any;
  refreshTime = 30000; // 30s

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    // Auto chọn tháng và năm hiện tại khi mở trang
    const today = new Date();
    this.selectedMonth = (today.getMonth() + 1).toString();
    this.selectedYear = today.getFullYear().toString();

    this.loadData();
    this.refreshInterval = setInterval(() => {
      this.loadData();
    }, this.refreshTime);
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  loadData() {
    this.loading = true;
    this.http.get<any>(this.GAS_URL).subscribe({
      next: (resp) => {
        this.columns = resp.columns || [];
        this.allWorkOrders = resp.data || [];
        this.years = this.getYearsList();
        this.filterData();
        this.loading = false;
        this.columnOptions = resp.options || resp.dropdown || {};
      },
      error: () => {
        this.errorMsg = 'Failed to load data';
        this.loading = false;
      }
    });
  }

  login() {
    if (this.username === 'anhtt' && this.password === '123456') {
      this.isLoggedIn = true;
      this.loginError = '';
    } else {
      this.loginError = 'Wrong account or password!';
    }
  }

  startEdit(i: number) {
    this.originalRowData = { ...this.workOrders[i] };
    this.editIndex = i;
  }

  cancelEdit() {
    if (this.editIndex !== null && this.originalRowData) {
      this.workOrders[this.editIndex] = { ...this.originalRowData };
    }
    this.editIndex = null;
    this.originalRowData = null;
  }

  saveRow(i: number) {
    const data = this.workOrders[i];
    const sheetRowIndex = data.row_id; 

    if (!sheetRowIndex) {
        alert('Save failed! Cannot identify the row to update. Please ensure row_id is available from the script.');
        return;
    }

    const payload = { row: sheetRowIndex, data };
    const httpOptions = {
      headers: new HttpHeaders({
        'Content-Type': 'text/plain;charset=utf-8',
      })
    };

    this.http.post<any>(this.GAS_URL, JSON.stringify(payload), httpOptions).subscribe({
      next: (response) => {
        if (response && response.status === 'success') {
          alert('Saved!');
          this.editIndex = null;
          this.originalRowData = null;
          const idx = this.allWorkOrders.findIndex(row => row.row_id === data.row_id);
          if (idx !== -1) {
            this.allWorkOrders[idx] = { ...data };
          }
        } else {
          alert('Save failed!\n' + (response.message || 'Unknown error from script.'));
        }
      },
      error: (err) => {
        const errorMessage = err?.error?.message || 'A server error occurred or the request was blocked (CORS issue). Please check the Apps Script configuration and ensure it has been re-deployed.';
        alert('Save failed!\n' + errorMessage);
        console.error(err);
      }
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

  openGoogleSheet() {
    window.open('https://docs.google.com/spreadsheets/d/17ZGxD7Ov-u1Yqu76dXtZBCM8F4rKrpYhpcvmSIt0I84/edit#gid=0', '_blank');
  }

  formatDatePD(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB'); // dd/MM/yyyy
  }
}
