import { Injectable } from '@angular/core';
import { REPORT_USD_RATE } from './report-data';

@Injectable({ providedIn: 'root' })
export class VietcombankRateService {
  /** Tỷ giá tạm tính cố định (VND/USD). */
  getLatestUsdTransferRate(): Promise<number> {
    return Promise.resolve(REPORT_USD_RATE);
  }
}
