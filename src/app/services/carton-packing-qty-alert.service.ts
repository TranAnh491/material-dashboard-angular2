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
}
