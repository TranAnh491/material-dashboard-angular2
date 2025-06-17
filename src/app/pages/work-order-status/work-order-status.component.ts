import { Component, OnInit } from '@angular/core';
import { GoogleSheetService } from '../../services/google-sheet.service';
import { AuthService } from '../../services/auth.service';
import { HttpClient } from '@angular/common/http';

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
  public selectedIndex: number | null = null;

  public googleSheetUrl = 'https://docs.google.com/spreadsheets/d/17ZGxD7Ov-u1Yqu76dXtZBCM8F4rKrpYhpcvmSIt0I84/edit#gid=0';

  // IMPORTANT: Please replace this with your Google Apps Script URL for the Work Order sheet.
  private sheetUrl = 'https://script.google.com/macros/s/AKfycbycffWLVmbTSAlnHB8rCci3mAYL45Ehl1TEYJbBrKzZPw86-tkXdU4DRGbCQyDT2j0c/exec';

  constructor(
    private sheetService: GoogleSheetService,
    private http: HttpClient,
    public auth: AuthService
  ) {}

  ngOnInit(): void {
    // Để trống, người dùng sẽ chủ động đăng nhập và tải dữ liệu
    this.handleSignIn();
  }

  handleSignIn() {
    this.isLoading = true;
    this.errorMessage = null;
    this.auth.signIn()
      .then(() => {
        console.log('✅ Đăng nhập thành công! Token:', this.auth.token);
        this.fetchWorkOrders();
      })
      .catch((error: any) => {
        this.isLoading = false;
        this.errorMessage = 'Đăng nhập thất bại. Vui lòng kiểm tra console (F12) để xem chi tiết lỗi.';
        console.error('Lỗi đăng nhập chi tiết:', error);
      });
  }
  
  handleSignOut() {
    this.auth.signOut();
    this.workOrders = [];
    this.tableHeaders = [];
    this.selectedWO = null;
    this.selectedIndex = null;
  }

  fetchWorkOrders() {
    this.isLoading = true;
    this.sheetService.getSheet('WO!A2:X').subscribe({ // Lấy từ A2 để bao gồm cả header
      next: (res: any) => {
        console.log('✅ Loaded data:', res);
        const headers = res.values[0];
        const data = res.values.slice(1);

        this.tableHeaders = headers;
        this.workOrders = data.map((row: string[]) => {
          const wo: any = {};
          headers.forEach((h, i) => wo[h] = row[i] || '');
          return wo;
        });
        
        this.isLoading = false;
      },
      error: err => {
        console.error('❌ Lỗi lấy sheet:', err);
        this.errorMessage = 'Lỗi khi lấy dữ liệu từ Google Sheets. Vui lòng kiểm tra quyền truy cập và tên sheet.';
        this.isLoading = false;
      }
    });
  }

  selectWO(index: number) {
    // Tạo một bản sao của đối tượng để tránh binding 2 chiều trực tiếp vào bảng
    this.selectedWO = { ...this.workOrders[index] };
    this.selectedIndex = index;
    console.log('Selected WO:', this.selectedWO);
  }

  saveUpdates() {
    if (!this.selectedWO || this.selectedIndex === null) {
      this.errorMessage = 'Vui lòng chọn một dòng để cập nhật.';
      return;
    }

    const updates = ['Check', 'Kitting', 'W.O Status'];
    updates.forEach(key => {
      const value = this.selectedWO[key];
      // Gọi hàm onCellUpdate đã có
      this.onCellUpdate(this.selectedIndex, key, value);
    });

    // Cập nhật lại dữ liệu trong bảng ngay lập tức
    this.workOrders[this.selectedIndex] = { ...this.selectedWO };
    alert('Cập nhật đã được gửi!');
  }
  
  onCellUpdate(rowIndex: number, header: string, value: string) {
    const colLetter = String.fromCharCode(65 + this.tableHeaders.indexOf(header));
    // Dữ liệu bắt đầu từ dòng 3 (index 2 trong array, vì A2 là header)
    const rowNumber = rowIndex + 3; 
    const range = `WO!${colLetter}${rowNumber}`;

    this.sheetService.updateCell(range, value.trim()).subscribe({
      next: () => {
        console.log(`✅ Updated range ${range} with value: ${value}`);
      },
      error: err => {
        console.error(`❌ Failed to update range ${range}:`, err);
        this.errorMessage = `Không thể cập nhật cột ${header}.`;
      }
    });
  }
}
