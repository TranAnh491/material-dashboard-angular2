import { Component, OnInit } from '@angular/core';
import { GoogleSheetService } from '../../services/google-sheet.service';
import { AuthService } from '../../services/auth.service';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';

interface WorkOrder {
  [key: string]: any;
}

@Component({
  selector: 'app-work-order-status',
  templateUrl: './work-order-status.component.html',
  styleUrls: ['./work-order-status.component.scss']
})
export class WorkOrderStatusComponent implements OnInit {
  public workOrders: WorkOrder[] = [];
  public tableHeaders: string[] = [];
  public isLoading = true;
  public errorMessage: string | null = null;
  public selectedWO: WorkOrder | null = null;

  public googleSheetUrl = 'https://docs.google.com/spreadsheets/d/17ZGxD7Ov-u1Yqu76dXtZBCM8F4rKrpYhpcvmSIt0I84/edit#gid=0';

  // IMPORTANT: Please replace this with your Google Apps Script URL for the Work Order sheet.
  private sheetUrl = 'https://script.google.com/macros/s/AKfycbycffWLVmbTSAlnHB8rCci3mAYL45Ehl1TEYJbBrKzZPw86-tkXdU4DRGbCQyDT2j0c/exec';

  constructor(
    private sheetService: GoogleSheetService,
    private http: HttpClient,
    public auth: AuthService
  ) {}

  ngOnInit(): void {
    // Tự động đăng nhập khi component được khởi tạo
    this.auth.signIn();

    if (this.sheetUrl === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
      this.isLoading = false;
      setTimeout(() => this.fetchWorkOrders(), 1000); // đợi token sẵn sàng
    }
  }

  fetchWorkOrders() {
    this.isLoading = true;
    this.sheetService.getSheet('Sheet1!A2:E').subscribe({
      next: (res: any) => {
        const headers = res.values[0];
        this.tableHeaders = headers;
        this.workOrders = res.values.slice(1).map((row: string[]) => {
          const wo: any = {};
          headers.forEach((h, i) => wo[h] = row[i] || '');
          return wo;
        });
        this.selectedWO = this.workOrders[0];
        this.isLoading = false;
      },
      error: err => {
        this.errorMessage = 'Lỗi khi lấy dữ liệu từ Google Sheets';
        this.isLoading = false;
        console.error(err);
      }
    });
  }

  selectWO(workOrder: WorkOrder) {
    this.selectedWO = workOrder;
  }

  onCellUpdate(rowIndex: number, header: string, value: string) {
    const colLetter = String.fromCharCode(65 + this.tableHeaders.indexOf(header));
    const rowNumber = rowIndex + 3; // A2 là tiêu đề, A3 là data đầu tiên
    const range = `Sheet1!${colLetter}${rowNumber}`;

    this.sheetService.updateCell(range, value.trim()).subscribe({
      next: () => {
        this.workOrders[rowIndex][header] = value.trim();
        console.log('Updated', range, value);
      },
      error: err => {
        console.error('Update failed', err);
        this.errorMessage = 'Không thể cập nhật Google Sheet';
      }
    });
  }
}
