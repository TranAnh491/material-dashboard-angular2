import { Injectable } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom } from 'rxjs';

/** Vượt quyền PXK lệch trên Work Order — OTP 4 số gửi Zalo tới ASP0106, mỗi LSX một mã. */
@Injectable({ providedIn: 'root' })
export class WoPxkBypassOtpService {
  private static readonly REQUEST_FN = 'requestWoPxkBypassOtpFn';
  private static readonly VERIFY_FN = 'verifyWoPxkBypassOtpFn';

  constructor(private fns: AngularFireFunctions) {}

  async requestOtp(opts: {
    lsx: string;
    requestedBy?: string;
    nextStatus?: string;
    factory?: string;
  }): Promise<void> {
    const payload = {
      lsx: String(opts.lsx || '').trim().toUpperCase().slice(0, 40),
      requestedBy: String(opts.requestedBy || '').trim().toUpperCase().slice(0, 20),
      nextStatus: String(opts.nextStatus || '').trim().slice(0, 20),
      factory: String(opts.factory || '').trim().toUpperCase().slice(0, 16)
    };
    const callable = this.fns.httpsCallable<typeof payload, { ok: boolean }>(
      WoPxkBypassOtpService.REQUEST_FN
    );
    await firstValueFrom(callable(payload));
  }

  async verifyOtp(code: string, lsx: string): Promise<boolean> {
    const payload = {
      code: String(code || '').trim(),
      lsx: String(lsx || '').trim().toUpperCase().slice(0, 40)
    };
    const callable = this.fns.httpsCallable<typeof payload, { ok: boolean }>(
      WoPxkBypassOtpService.VERIFY_FN
    );
    const res = await firstValueFrom(callable(payload));
    const ok = !!(res as { ok?: boolean })?.ok || !!(res as { data?: { ok?: boolean } })?.data?.ok;
    return ok;
  }
}
