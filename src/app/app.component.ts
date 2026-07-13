import { Component, OnInit } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom } from 'rxjs';
import { ClientReloadService } from './services/client-reload.service';
import { FirebaseAuthService } from './services/firebase-auth.service';

/** Các tài khoản dùng chung/hệ thống — không bắt cập nhật email công ty. */
const EXEMPT_LOGIN_EMAILS = new Set(['asp0001@asp.com', 'asp9999@asp.com', 'xetai@asp.com']);

function isCompanyEmail(email: string): boolean {
  const e = (email || '').trim().toLowerCase();
  return e.endsWith('@airspeedmfgvn.com') || e.endsWith('@airspeedmfg.com');
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  updateAvailable = false;

  needsCompanyEmailUpdate = false;
  companyEmailInput = '';
  companyEmailSubmitting = false;
  companyEmailError = '';

  constructor(
    private clientReloadService: ClientReloadService,
    private authService: FirebaseAuthService,
    private fns: AngularFireFunctions
  ) {}

  ngOnInit(): void {
    this.clientReloadService.startListening();
    this.clientReloadService.updateAvailable$.subscribe(available => {
      this.updateAvailable = available;
    });

    this.authService.user$.subscribe(user => {
      if (!user) {
        this.needsCompanyEmailUpdate = false;
        return;
      }
      const dept = String(user.department || '').trim().toUpperCase();
      const email = String(user.email || '').trim().toLowerCase();
      const isExempt = dept === 'WH' || EXEMPT_LOGIN_EMAILS.has(email);
      this.needsCompanyEmailUpdate = !isExempt && !isCompanyEmail(email);
    });
  }

  reloadNow(): void {
    this.clientReloadService.reloadNow();
  }

  async submitCompanyEmail(): Promise<void> {
    const email = this.companyEmailInput.trim();
    if (!email) {
      this.companyEmailError = 'Vui lòng nhập email công ty.';
      return;
    }
    this.companyEmailSubmitting = true;
    this.companyEmailError = '';
    try {
      await firstValueFrom(this.fns.httpsCallable('selfUpdateCompanyEmailFn')({ email }));
      this.needsCompanyEmailUpdate = false;
    } catch (e: any) {
      this.companyEmailError = e?.message || 'Cập nhật thất bại. Vui lòng thử lại.';
    } finally {
      this.companyEmailSubmitting = false;
    }
  }
}
