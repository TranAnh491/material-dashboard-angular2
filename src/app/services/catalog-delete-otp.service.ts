import { Injectable } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom } from 'rxjs';

export type CatalogDeleteScope = 'nvl' | 'tp';

/** Xóa toàn bộ Danh mục NVL/TP — yêu cầu mã OTP 4 số gửi qua Zalo tới ASP0106. */
@Injectable({ providedIn: 'root' })
export class CatalogDeleteOtpService {
  private static readonly REQUEST_FN = 'requestCatalogDeleteOtpFn';
  private static readonly VERIFY_FN = 'verifyCatalogDeleteOtpFn';

  constructor(private fns: AngularFireFunctions) {}

  async requestOtp(scope: CatalogDeleteScope, requestedBy?: string): Promise<void> {
    const callable = this.fns.httpsCallable<
      { scope: CatalogDeleteScope; requestedBy: string },
      { ok: boolean }
    >(CatalogDeleteOtpService.REQUEST_FN);
    await firstValueFrom(
      callable({ scope, requestedBy: String(requestedBy || '').trim().toUpperCase().slice(0, 20) })
    );
  }

  async verifyOtp(scope: CatalogDeleteScope, code: string): Promise<boolean> {
    const callable = this.fns.httpsCallable<
      { scope: CatalogDeleteScope; code: string },
      { ok: boolean }
    >(CatalogDeleteOtpService.VERIFY_FN);
    const res = await firstValueFrom(callable({ scope, code: code.trim() }));
    return res?.ok === true;
  }
}
