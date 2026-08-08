import { Injectable } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

/** Phiên mở khóa thao tác tồn kho (More → import/xóa/đổi tồn) — OTP Zalo tới ASP0106. */
@Injectable({ providedIn: 'root' })
export class MaterialsInventoryUnlockService {
  static readonly UNLOCK_MS = 10 * 60 * 1000;
  private static readonly REQUEST_FN = 'requestMaterialsInventoryOtpFn';
  private static readonly VERIFY_FN = 'verifyMaterialsInventoryOtpFn';

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

  async requestOtp(opts: {
    requestedBy?: string;
    actionLabel?: string;
    factory?: string;
  }): Promise<void> {
    const payload = {
      requestedBy: String(opts.requestedBy || '').trim().toUpperCase().slice(0, 20),
      actionLabel: String(opts.actionLabel || '').trim().slice(0, 120),
      factory: String(opts.factory || '').trim().toUpperCase().slice(0, 10)
    };
    const callable = this.fns.httpsCallable<typeof payload, { ok: boolean }>(
      MaterialsInventoryUnlockService.REQUEST_FN
    );
    await firstValueFrom(callable(payload));
  }

  async verifyOtp(code: string): Promise<boolean> {
    const callable = this.fns.httpsCallable<{ code: string }, { ok: boolean }>(
      MaterialsInventoryUnlockService.VERIFY_FN
    );
    const res = await firstValueFrom(callable({ code: code.trim() }));
    if (!res?.ok) return false;
    this.unlockExpiresAt = Date.now() + MaterialsInventoryUnlockService.UNLOCK_MS;
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
