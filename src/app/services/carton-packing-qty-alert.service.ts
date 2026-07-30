import { Injectable } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom } from 'rxjs';

export interface CartonPackingQtyAlertPayload {
  materialCode: string;
  oldQty: number;
  newQty: number;
  quantity: number;
  lot: string;
  lsx: string;
  factory: string;
  reportedBy: string;
}

export interface TpCatalogPackingMismatchPayload {
  materialCode: string;
  standardQty: number;
  cartonPackingQty: number;
  reportedBy: string;
}

/** FG In — nút "Sai Carton": báo mail cho Kho + Kỹ thuật khi Lượng SP/thùng trong danh mục sai thực tế. */
@Injectable({ providedIn: 'root' })
export class CartonPackingQtyAlertService {
  constructor(private fns: AngularFireFunctions) {}

  async sendAlert(payload: CartonPackingQtyAlertPayload): Promise<void> {
    const callable = this.fns.httpsCallable<CartonPackingQtyAlertPayload, { ok: boolean }>(
      'sendCartonPackingQtyAlertEmailFn'
    );
    await firstValueFrom(callable(payload));
  }

  /** Danh mục TP — cột "Gửi mail": báo Kho + Kỹ thuật khi mã đang lệch SL SP/thùng ≠ Lượng Đóng Thùng. */
  async sendTpCatalogMismatchAlert(payload: TpCatalogPackingMismatchPayload): Promise<void> {
    const callable = this.fns.httpsCallable<TpCatalogPackingMismatchPayload, { ok: boolean }>(
      'sendTpCatalogPackingMismatchEmailFn'
    );
    await firstValueFrom(callable(payload));
  }
}
