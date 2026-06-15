import { Injectable } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

/** Phiên mở khóa thêm vị trí mới (tab Location) — OTP gửi Zalo tới ASP0106. */
@Injectable({ providedIn: 'root' })
export class LocationAddUnlockService {
  static readonly UNLOCK_MS = 10 * 60 * 1000;
  /** Dùng function đã deploy; forLocationAdd=true để tin Zalo đúng nội dung Location. */
  private static readonly UNLOCK_FN = 'requestLocationUnlockOtpFn';
  private static readonly VERIFY_FN = 'verifyLocationUnlockOtpFn';

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

  async requestOtp(requestedBy?: string, locationName?: string): Promise<void> {
    const payload = {
      forLocationAdd: true,
      employeeId: 'ASP0106',
      requestedBy: String(requestedBy || '').trim().toUpperCase().slice(0, 20),
      locationName: String(locationName || '').trim().slice(0, 80)
    };
    const callable = this.fns.httpsCallable<typeof payload, { ok: boolean }>(
      LocationAddUnlockService.UNLOCK_FN
    );
    await firstValueFrom(callable(payload));
  }

  async verifyOtp(code: string): Promise<boolean> {
    const callable = this.fns.httpsCallable<
      { forLocationAdd: boolean; employeeId: string; code: string },
      { ok: boolean }
    >(LocationAddUnlockService.VERIFY_FN);
    const res = await firstValueFrom(
      callable({
        forLocationAdd: true,
        employeeId: 'ASP0106',
        code: code.trim()
      })
    );
    if (!res?.ok) return false;
    this.unlockExpiresAt = Date.now() + LocationAddUnlockService.UNLOCK_MS;
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
