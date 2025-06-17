import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-work-order-status',
  templateUrl: './work-order-status.component.html',
  styleUrls: ['./work-order-status.component.scss']
})
export class WorkOrderStatusComponent implements OnInit {
  displayedRows: any[] = [];
  isLoading = true;
  tableHeaders: string[] = [];

  ngOnInit(): void {
    this.fetchData();
  }

  fetchData() {
    this.isLoading = true;
    const currentMonth = new Date().getMonth() + 1;

    fetch('https://script.google.com/macros/s/AKfycbwWroXixwj-6a_1Az3AzG05oquLqmpR3AlUNwY41g5itqdJfH-eMDMlYuU29iGsNA/exec')
      .then(res => res.json())
      .then(data => {
        const headers = data.shift(); // Lấy headers
        this.tableHeaders = headers; // Lưu headers để dùng trong template

        const allRowsAsObjects = data.map(row => {
          const wo = {};
          headers.forEach((header, index) => {
            wo[header] = row[index];
          });
          return wo;
        });

        this.displayedRows = allRowsAsObjects.filter((row: any) => {
          // Đảm bảo cột 'Month' tồn tại và hợp lệ trước khi so sánh
          return row['Month'] && Number(row['Month']) === currentMonth;
        });
        
        this.isLoading = false;
      })
      .catch(err => {
        console.error('❌ Lỗi khi tải dữ liệu:', err);
        this.isLoading = false;
      });
  }
}
