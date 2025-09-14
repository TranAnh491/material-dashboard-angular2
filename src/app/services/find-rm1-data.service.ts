import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface FindRM1Data {
  materialCode: string;
  po: string;
  batch?: string;
  location: string;
  quantity: number;
  timestamp: number;
}

@Injectable({
  providedIn: 'root'
})
export class FindRM1DataService {
  private fillDataSubject = new BehaviorSubject<FindRM1Data | null>(null);
  public fillData$ = this.fillDataSubject.asObservable();

  constructor() {
    // Lắng nghe thay đổi từ localStorage
    this.listenToStorageChanges();
  }

  /**
   * Lắng nghe thay đổi từ localStorage
   */
  private listenToStorageChanges(): void {
    // Kiểm tra localStorage mỗi 500ms
    setInterval(() => {
      const data = localStorage.getItem('findRM1_fillData');
      if (data) {
        try {
          const parsedData = JSON.parse(data);
          // Thêm timestamp để theo dõi
          parsedData.timestamp = Date.now();
          this.fillDataSubject.next(parsedData);
          
          // Xóa dữ liệu sau khi đã đọc (tránh duplicate)
          localStorage.removeItem('findRM1_fillData');
        } catch (error) {
          console.error('Error parsing findRM1 data:', error);
        }
      }
    }, 500);
  }

  /**
   * Lấy dữ liệu fill hiện tại
   */
  getCurrentFillData(): FindRM1Data | null {
    return this.fillDataSubject.value;
  }

  /**
   * Lấy dữ liệu fill mới nhất
   */
  getLatestFillData(): Observable<FindRM1Data | null> {
    return this.fillData$;
  }

  /**
   * Clear dữ liệu fill
   */
  clearFillData(): void {
    this.fillDataSubject.next(null);
    localStorage.removeItem('findRM1_fillData');
  }

  /**
   * Kiểm tra xem có dữ liệu fill mới không
   */
  hasNewFillData(): boolean {
    const data = this.getCurrentFillData();
    if (!data) return false;
    
    // Dữ liệu được coi là mới nếu < 30 giây
    const thirtySecondsAgo = Date.now() - 30000;
    return data.timestamp > thirtySecondsAgo;
  }
}
