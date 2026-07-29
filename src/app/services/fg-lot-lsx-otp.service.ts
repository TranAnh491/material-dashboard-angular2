import { Injectable } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

export type FgLotLsxOtpMeta = {
  requestedBy?: string;
  materialCode?: string;
  batchNumber?: string;
  field?: 'LOT' | 'LSX' | string;
  oldValue?: string;
  newValue?: string;
};

/** Sửa LOT/LSX trên FG Inventory — OTP 4 số gửi Zalo tới ASP0106 (giống thêm vị trí). */
@Injectable({ providedIn: 'root' })
export class FgLotLsxOtpService {
  static readonly UNLOCK_MS = 10 * 60 * 1000;
  private static readonly REQUEST_FN = 'requestFgLotLsxOtpFn';
  private static readonly VERIFY_FN = 'verifyFgLotLsxOtpFn';

  private unlockExpiresAt = 0;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly unlockedSubject = new BehaviorSubject<boolean>(false);

  readonly unlocked$ = this.unlockedSubject.asObservable();

  constructor(private fns: AngularFireFunctions) {}

  isUnlocked(): boolean {
    if (!this.unlockExpiresAt) return false;
    if (Date.now() > this.unlockExpiresAt) {
      this.lock();
      return false;
    }
    return true;
  }

  lock(): void {
    this.unlockExpiresAt = 0;
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    this.unlockedSubject.next(false);
  }

  async requestOtp(meta: FgLotLsxOtpMeta = {}): Promise<void> {
    const payload = {
      requestedBy: String(meta.requestedBy || '').trim().toUpperCase().slice(0, 20),
      materialCode: String(meta.materialCode || '').trim().toUpperCase().slice(0, 40),
      batchNumber: String(meta.batchNumber || '').trim().toUpperCase().slice(0, 40),
      field: String(meta.field || 'LOT').trim().toUpperCase().slice(0, 8),
      oldValue: String(meta.oldValue || '').trim().slice(0, 80),
      newValue: String(meta.newValue || '').trim().slice(0, 80)
    };
    const callable = this.fns.httpsCallable<typeof payload, { ok: boolean }>(
      FgLotLsxOtpService.REQUEST_FN
    );
    await firstValueFrom(callable(payload));
  }

  async verifyOtp(code: string): Promise<boolean> {
    const callable = this.fns.httpsCallable<{ code: string }, { ok: boolean }>(
      FgLotLsxOtpService.VERIFY_FN
    );
    const res = await firstValueFrom(callable({ code: code.trim() }));
    if (!res?.ok) return false;
    this.unlockExpiresAt = Date.now() + FgLotLsxOtpService.UNLOCK_MS;
    this.scheduleExpiry();
    this.unlockedSubject.next(true);
    return true;
  }

  private scheduleExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    const remaining = this.unlockExpiresAt - Date.now();
    if (remaining <= 0) {
      this.lock();
      return;
    }
    this.expiryTimer = setTimeout(() => this.lock(), remaining);
  }
}
