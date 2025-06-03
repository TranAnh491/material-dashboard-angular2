import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-work-order-status',
  templateUrl: './work-order-status.component.html',
  styleUrls: ['./work-order-status.component.scss'] // Nếu dùng .scss thì đổi thành .scss cũng được
})
export class WorkOrderStatusComponent implements OnInit {
  workOrders: any[] = [];
  columns: string[] = [];
  loading = true;
  errorMsg = '';
  GAS_URL = 'https://script.google.com/macros/s/AKfycbyM1qg6foGjZdr-y1f8ZiKJ8N-x5FU2VunC6Z_JsYBLsWR13V4fm_j0Z7sahKxCdvKX/exec'; // ví dụ: https://script.google.com/macros/s/....../exec
  isLoggedIn = false;
  username = '';
  password = '';
  loginError = '';

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.http.get<any[]>(this.GAS_URL).subscribe({
      next: (data) => {
        if (data.length) this.columns = Object.keys(data[0]);
        this.workOrders = data;
        this.loading = false;
      },
      error: (err) => {
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
    this.http.post<any>(this.GAS_URL, {row: i, data}).subscribe({
      next: (resp) => alert('Saved!'),
      error: () => alert('Save failed!')
    });
  }
}
