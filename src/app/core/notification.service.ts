import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  // !!! VUI LÒNG THAY THẾ BẰNG URL GOOGLE APPS SCRIPT CỦA BẠN !!!
  private googleScriptUrl = 'https://script.google.com/macros/s/AKfycby9_GtwzJ5AYbfVx1vh54Zl6E-6Vw7uUUhIjDSJgLNx6zE-XuBWDXBXA5fazsXrTwR1fA/exec';

  constructor(private http: HttpClient) { }

  getNotificationCount(): Observable<{status: string, count: number, message?: string}> {
    if (this.googleScriptUrl === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
        // Trả về lỗi nếu URL chưa được cấu hình
        return new Observable(observer => {
            observer.error('Google Apps Script URL is not configured in notification.service.ts');
        });
    }
    return this.http.get<{status: string, count: number, message?: string}>(this.googleScriptUrl);
  }
} 