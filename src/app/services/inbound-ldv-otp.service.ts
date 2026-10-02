import { Injectable } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom } from 'rxjs';

/** OTP 4 số Zalo → nhóm Quản lý kho để sửa lượng đơn vị đã nhập trên Inbound. */
@Injectable({ providedIn: 'root' })
export class InboundLdvOtpService {
  constructor(private fns: AngularFireFunctions) {}

  async requestOtp(opts: { requestedBy?: string; materialCode?: string; factory?: string }): Promise<void> {
    const callable = this.fns.httpsCallable<typeof opts, { ok: boolean }>('requestInboundLdvOtpFn');
    await firstValueFrom(callable({
      requestedBy: String(opts.requestedBy || '').trim().toUpperCase().slice(0, 20),
      materialCode: String(opts.materialCode || '').trim().slice(0, 80),
      factory: String(opts.factory || '').trim().toUpperCase().slice(0, 10)
    }));
  }

  async verifyOtp(code: string): Promise<boolean> {
    const callable = this.fns.httpsCallable<{ code: string }, { ok: boolean }>('verifyInboundLdvOtpFn');
    const res = await firstValueFrom(callable({ code: code.trim() }));
    return !!res?.ok;
  }

  async sendMismatchEmail(payload: {
    materialCode: string;
    poNumber: string;
    batchNumber: string;
    factory: string;
    rollsOrBags: number;
    standardPacking: number;
    reportedBy: string;
  }): Promise<void> {
    const callable = this.fns.httpsCallable<typeof payload, { ok: boolean }>('sendInboundLdvMismatchEmailFn');
    await firstValueFrom(callable(payload));
  }
}
