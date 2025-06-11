import { Component, OnInit, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-work-order-status',
  templateUrl: './work-order-status.component.html',
  styleUrls: ['./work-order-status.component.scss']
})
export class WorkOrderStatusComponent implements OnInit, OnDestroy {
  workOrders: any[] = [];
  allWorkOrders: any[] = [];
  columns: string[] = [];
  loading = true;
  errorMsg = '';
  GAS_URL = 'https://script.google.com/macros/s/AKfycbycffWLVmbTSAlnHB8rCci3mAYL45Ehl1TEYJbBrKzZPw86-tkXdU4DRGbCQyDT2j0c/exec';
  SHEET_URL_FOR_EDITING = 'https://docs.google.com/spreadsheets/d/17ZGxD7Ov-u1Yqu76dXtZBCM8F4rKrpYhpcvmSIt0I84/edit?gid=0';

  selectedYear: string = '';
  selectedMonth: string = '';
  years: string[] = [];
  months: string[] = ['1','2','3','4','5','6','7','8','9','10','11','12'];

  yearColumn: string = 'Year';
  monthColumn: string = 'Month';

  refreshInterval: any;
  refreshTime = 30000; // 30s

  embeddedSheetUrl: SafeResourceUrl | null = null;

  constructor(private http: HttpClient, private sanitizer: DomSanitizer) {}

  ngOnInit(): void {
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
      },
      error: () => {
        this.errorMsg = 'Failed to load data';
        this.loading = false;
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
  }
  
  showSheetForEditing() {
    const embedUrl = `${this.SHEET_URL_FOR_EDITING}&rm=minimal`;
    this.embeddedSheetUrl = this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl);
  }

  hideSheet() {
    this.embeddedSheetUrl = null;
    this.loadData(); // Tải lại dữ liệu sau khi chỉnh sửa xong
  }

  formatDatePD(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB'); // dd/MM/yyyy
  }
}
