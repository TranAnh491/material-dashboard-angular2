import { Injectable } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom } from 'rxjs';

export interface InventoryStockReportPayload {
  factory: string;
  materialCode: string;
  po: string;
  imd: string;
  stock: string;
  location: string;
  status: string;
  reportedBy: string;
  /** Dòng nội dung cuối tin Zalo; bỏ trống = câu mặc định "đã hết hàng". */
  detail?: string;
}

/** Tab Materials: cột Báo cáo → bot Zalo nhắn nhóm Quản lý kho. */
@Injectable({ providedIn: 'root' })
export class InventoryStockReportService {
  constructor(private fns: AngularFireFunctions) {}

  async notify(payload: InventoryStockReportPayload): Promise<void> {
    const callable = this.fns.httpsCallable<InventoryStockReportPayload, { ok: boolean }>('notifyInventoryStockReportFn');
    await firstValueFrom(callable(payload));
  }
}
