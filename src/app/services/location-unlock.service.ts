import { Injectable } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class LocationUnlockService {
  static readonly ALLOWED_IDS = ['ASP0106', 'ASP0119', 'ASP0538', 'ASP1761'] as const;
  static readonly UNLOCK_MS = 10 * 60 * 1000;

  private unlockedEmployeeId: string | null = null;
  private unlockExpiresAt = 0;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly unlockedSubject = new BehaviorSubject<boolean>(false);

  /** Theo dõi trạng thái mở khóa (hết hạn 10 phút hoặc F5 → false). */
  readonly unlocked$ = this.unlockedSubject.asObservable();

  constructor(private fns: AngularFireFunctions) {}

  isUnlocked(): boolean {
    if (!this.unlockedEmployeeId) return false;
    if (Date.now() > this.unlockExpiresAt) {
      this.lock();
      return false;
    }
    return true;
  }

  getEmployeeId(): string | null {
    return this.isUnlocked() ? this.unlockedEmployeeId : null;
  }

  lock(): void {
    this.unlockedEmployeeId = null;
    this.unlockExpiresAt = 0;
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    this.unlockedSubject.next(false);
  }

  async requestOtp(employeeId: string): Promise<void> {
    const callable = this.fns.httpsCallable<{ employeeId: string }, { ok: boolean }>(
      'requestLocationUnlockOtpFn'
    );
    await firstValueFrom(callable({ employeeId: employeeId.trim().toUpperCase() }));
  }

  async verifyOtp(employeeId: string, code: string): Promise<boolean> {
    const callable = this.fns.httpsCallable<
      { employeeId: string; code: string },
      { ok: boolean; employeeId?: string }
    >('verifyLocationUnlockOtpFn');
    const res = await firstValueFrom(
      callable({
        employeeId: employeeId.trim().toUpperCase(),
        code: code.trim()
      })
    );
    if (!res?.ok) return false;
    const id = String(res.employeeId || employeeId).trim().toUpperCase();
    this.unlockedEmployeeId = id;
    this.unlockExpiresAt = Date.now() + LocationUnlockService.UNLOCK_MS;
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
