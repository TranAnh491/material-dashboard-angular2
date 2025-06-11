import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';

// Define an interface for a single Work Order.
// The properties are generic for now. They will be dynamically determined from the sheet.
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

  // IMPORTANT: Please replace this with your Google Apps Script URL for the Work Order sheet.
  private sheetUrl = 'https://script.google.com/macros/s/AKfycbycffWLVmbTSAlnHB8rCci3mAYL45Ehl1TEYJbBrKzZPw86-tkXdU4DRGbCQyDT2j0c/exec';

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    if (this.sheetUrl === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
      this.isLoading = false;
      this.errorMessage = "Vui lòng cập nhật URL Google Apps Script trong work-order-status.component.ts để tải dữ liệu.";
      console.error(this.errorMessage);
    } else {
      this.fetchWorkOrders();
    }
  }

  fetchWorkOrders() {
    this.isLoading = true;
    this.errorMessage = null;
    this.http.get<any[]>(this.sheetUrl).subscribe({
      next: (data) => {
        console.log('Work Order Data from Google Sheet:', data);
        if (data && data.length > 0) {
          // Assuming the first object's keys are the headers.
          // This makes the component flexible to different sheet structures.
          this.tableHeaders = Object.keys(data[0]);
          this.workOrders = data;
        } else {
           this.errorMessage = "Không có dữ liệu hoặc định dạng dữ liệu không đúng từ Google Sheet.";
        }
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error fetching work orders:', error);
        this.errorMessage = "Đã xảy ra lỗi khi tải dữ liệu. Vui lòng kiểm tra lại URL và cài đặt Google Apps Script.";
        this.isLoading = false;
      }
    });
  }

  // This function is called when a cell loses focus (e.g., user clicks away or presses Enter).
  onCellUpdate(rowIndex: number, header: string, value: string) {
    const workOrder = this.workOrders[rowIndex];
    const originalValue = workOrder[header];
    const trimmedValue = value.trim();

    // If the value hasn't changed, do nothing.
    if (originalValue === trimmedValue) {
      return;
    }

    console.log(`Updating row ${rowIndex}, column "${header}" to new value: "${trimmedValue}"`);
    
    // Update the local data immediately for a responsive UI.
    workOrder[header] = trimmedValue;
    
    // --- Send update to Google Sheet ---
    // We assume the first column header is the unique identifier for the row.
    const uniqueIdHeader = this.tableHeaders[0]; 
    const uniqueId = workOrder[uniqueIdHeader];

    if (!uniqueId) {
      console.error('Cannot update row because the unique identifier is missing.');
      this.errorMessage = `Lỗi: Không thể cập nhật dòng vì thiếu mã định danh duy nhất (cột '${uniqueIdHeader}').`;
      // Optionally, revert the change in the UI
      workOrder[header] = originalValue;
      return;
    }

    const updatePayload = {
      id: uniqueId,
      column: header,
      value: trimmedValue
    };
    
    console.log('Sending this payload to Google Apps Script:', updatePayload);

    this.http.post(this.sheetUrl, updatePayload).subscribe({
      next: (response) => {
        console.log('Update successful:', response);
        // You might want to show a success toast message here.
      },
      error: (error) => {
        console.error('Failed to update Google Sheet:', error);
        this.errorMessage = `Lỗi khi cập nhật Google Sheet. Thay đổi của bạn có thể chưa được lưu.`;
        // Revert the local data since the update failed.
        workOrder[header] = originalValue;
      }
    });
  }
}
