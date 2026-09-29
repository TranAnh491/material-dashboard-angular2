import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom } from 'rxjs';
import { QRScannerModalComponent } from '../../components/qr-scanner-modal/qr-scanner-modal.component';
import { FirebaseAuthService } from '../../services/firebase-auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {
  @ViewChild('loginScanInput') loginScanInput?: ElementRef<HTMLInputElement>;

  loginForm: FormGroup;
  signupForm: FormGroup;
  isSignup = false;
  loading = false;
  scanReady = false;
  currentLanguage: 'en' | 'vi' = 'vi'; // Default to Vietnamese
  private readonly loginEmailCacheKey = 'aspLoginEmailById';
  private readonly loginEmailInflight = new Map<string, Promise<string>>();

  unlockLoginAutofill(event: Event): void {
    const el = event.target as HTMLInputElement | null;
    if (el?.hasAttribute('readonly')) {
      el.removeAttribute('readonly');
    }
  }

  onEmployeeIdInput(event: Event, formType: 'login' | 'signup'): void {
    const inputEl = event.target as HTMLInputElement;
    const raw = inputEl.value || '';

    const upper = raw.toUpperCase();
    if (inputEl.value !== upper) {
      inputEl.value = upper;
    }

    const form = formType === 'login' ? this.loginForm : this.signupForm;
    const control = form.get('employeeId');
    if (control && control.value !== upper) {
      control.setValue(upper, { emitEvent: false });
      control.updateValueAndValidity({ emitEvent: false });
    }

    if (formType === 'login' && /^ASP\d{4}$/.test(upper)) {
      void this.resolveLoginEmailForSignIn(upper);
    }
  }

  constructor(
    private fb: FormBuilder,
    private authService: FirebaseAuthService,
    private snackBar: MatSnackBar,
    private router: Router,
    private fns: AngularFireFunctions,
    private dialog: MatDialog
  ) {
    /** Đăng nhập: ASP + 4 số (ASP9999 cho xe tải) hoặc XETAI. */
    this.loginForm = this.fb.group({
      employeeId: ['', [Validators.required, Validators.pattern(/^(ASP\d{4}|XETAI)$/i)]],
      password: ['', [Validators.required]]
    });

    /** Đăng ký: ID ASP + họ tên + bộ phận + email → mật khẩu 6 số gửi qua email */
    this.signupForm = this.fb.group({
      employeeId: ['', [Validators.required, Validators.pattern(/^ASP\d{4}$/i)]],
      fullName: ['', [Validators.required, Validators.minLength(2)]],
      department: ['', [Validators.required]],
      email: [
        '',
        [
          Validators.required,
          Validators.pattern(/^[^\s@]+@(airspeedmfgvn\.com|airspeedmfg\.com)$/i)
        ]
      ]
    });
  }

  /** Chuẩn hóa ô đăng nhập: email nguyên chữ thường; ASPxxxx → aspxxxx@asp.com */
  private loginFieldToEmail(raw: string): string {
    const t = (raw || '').trim();
    if (t.includes('@')) {
      return t.toLowerCase();
    }
    const upper = t.toUpperCase();
    const m = upper.match(/^ASP(\d{4})$/);
    if (m) {
      return `asp${m[1]}@asp.com`;
    }
    return `${upper}@asp.com`;
  }

  /**
   * Tra email Firebase Auth theo mã ASPxxxx (đăng ký qua mail dùng email công ty).
   * Lỗi mạng / chưa deploy function → fallback asp####@asp.com như cũ.
   */
  private readCachedLoginEmail(employeeId: string): string {
    try {
      const raw = localStorage.getItem(this.loginEmailCacheKey);
      if (!raw) return '';
      const map = JSON.parse(raw) as Record<string, string>;
      const email = map[employeeId];
      return typeof email === 'string' ? email.trim().toLowerCase() : '';
    } catch {
      return '';
    }
  }

  private writeCachedLoginEmail(employeeId: string, email: string): void {
    try {
      const raw = localStorage.getItem(this.loginEmailCacheKey);
      const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      map[employeeId] = email.trim().toLowerCase();
      localStorage.setItem(this.loginEmailCacheKey, JSON.stringify(map));
    } catch {
      // ignore quota / private mode
    }
  }

  private clearCachedLoginEmail(employeeId: string): void {
    try {
      const raw = localStorage.getItem(this.loginEmailCacheKey);
      if (!raw) return;
      const map = JSON.parse(raw) as Record<string, string>;
      delete map[employeeId];
      localStorage.setItem(this.loginEmailCacheKey, JSON.stringify(map));
    } catch {
      // ignore
    }
  }

  private async resolveLoginEmailForSignIn(employeeId: string, skipCache = false): Promise<string> {
    const upper = (employeeId || '').trim().toUpperCase();
    if (!/^ASP\d{4}$/.test(upper)) {
      return this.loginFieldToEmail(employeeId);
    }
    if (!skipCache) {
      const cached = this.readCachedLoginEmail(upper);
      if (cached) return cached;
      const pending = this.loginEmailInflight.get(upper);
      if (pending) return pending;
    }
    const job = this.fetchLoginEmail(upper);
    this.loginEmailInflight.set(upper, job);
    try {
      return await job;
    } finally {
      if (this.loginEmailInflight.get(upper) === job) {
        this.loginEmailInflight.delete(upper);
      }
    }
  }

  private async fetchLoginEmail(employeeId: string): Promise<string> {
    try {
      const result = await firstValueFrom(
        this.fns.httpsCallable('lookupAuthLoginEmailByEmployeeIdFn')({ employeeId })
      );
      const payload = (result as { data?: { email?: string | null } })?.data ?? (result as { email?: string | null });
      const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : '';
      if (email) {
        this.writeCachedLoginEmail(employeeId, email);
        return email;
      }
    } catch {
      // ignore — fallback legacy asp####@asp.com
    }
    return this.loginFieldToEmail(employeeId);
  }

  ngOnInit(): void {
    // Load ngôn ngữ từ localStorage
    const savedLanguage = localStorage.getItem('preferredLanguage');
    if (savedLanguage === 'en' || savedLanguage === 'vi') {
      this.currentLanguage = savedLanguage;
    }

    // Đã đăng nhập → Menu (tránh auto load Dashboard tốn Firestore reads)
    this.authService.isAuthenticated.subscribe(isAuth => {
      if (isAuth) {
        this.navigateAfterLogin();
      }
    });

    void import('../../layouts/admin-layout/admin-layout.module');
  }

  /** Sau đăng nhập: app phụ Xe Tải → /xe-tai, app chính → /menu */
  private navigateAfterLogin(): void {
    const menuRoute = this.router.config.find((r) => r.path === 'menu');
    const toXeTai = !!(menuRoute && (menuRoute as { redirectTo?: string }).redirectTo === 'xe-tai');
    this.router.navigate([toXeTai ? '/xe-tai' : '/menu']);
  }

  private readonly truckDriverEmployeeIds = new Set(['ASP9999', 'XETAI']);

  private isTruckDriverLogin(employeeId: string): boolean {
    return this.truckDriverEmployeeIds.has(String(employeeId || '').trim().toUpperCase());
  }

  private toTruckAuthPassword(password: string): string {
    const p = String(password || '').trim();
    return p.length >= 6 ? p : p.padEnd(6, '0');
  }

  private async signInTruckDriver(employeeId: string, password: string): Promise<void> {
    const result = await firstValueFrom(
      this.fns.httpsCallable('truckDriverSignInFn')({ employeeId, password })
    );
    const payload =
      (result as { data?: { email?: string; authPassword?: string } })?.data ??
      (result as { email?: string; authPassword?: string });
    const email = typeof payload?.email === 'string'
      ? payload.email.trim().toLowerCase()
      : this.loginFieldToEmail(employeeId);
    const authPassword =
      typeof payload?.authPassword === 'string' && payload.authPassword
        ? payload.authPassword
        : this.toTruckAuthPassword(password);
    await this.authService.signIn(email, authPassword);
  }

  async onLogin(): Promise<void> {
    if (this.loginForm.valid) {
      this.loading = true;
      try {
        const { employeeId, password } = this.loginForm.value;
        const emp = String(employeeId || '').trim().toUpperCase();
        const pass = String(password || '').trim();

        // Xử lý tài khoản đặc biệt ASP0001
        if (emp === 'ASP0001' && pass === '112233') {
          await this.authService.signInSpecialUser('ASP0001', 'ASP0001@asp.com', 'special-asp0001-uid');
          this.showMessage(
            this.currentLanguage === 'en' ? 'Admin login successful!' : 'Đăng nhập quản lý thành công!', 
            'success'
          );
          this.clearLoginFields();
          this.navigateAfterLogin();
          return;
        }

        // Tài xế app phụ Xe Tải: ASP9999 / XETAI + 123456
        if (this.isTruckDriverLogin(emp)) {
          if (pass.length < 6) {
            this.showMessage(
              this.currentLanguage === 'en' ? 'Password must be at least 6 characters' : 'Mật khẩu phải có ít nhất 6 ký tự',
              'error'
            );
            return;
          }
          await this.signInTruckDriver(emp, pass);
          this.showMessage(
            this.currentLanguage === 'en' ? 'Login successful!' : 'Đăng nhập thành công!',
            'success'
          );
          this.clearLoginFields();
          this.navigateAfterLogin();
          return;
        }

        if (pass.length < 4) {
          this.showMessage(
            this.currentLanguage === 'en' ? 'Password must be at least 4 characters' : 'Mật khẩu phải có ít nhất 4 ký tự',
            'error'
          );
          return;
        }
        
        const cachedBefore = this.readCachedLoginEmail(emp);
        let email = await this.resolveLoginEmailForSignIn(emp);
        const fromCache = !!cachedBefore && cachedBefore === email;
        try {
          await this.authService.signIn(email, this.authService.authPasswordFor(pass));
        } catch (error: any) {
          const code = String(error?.code || '');
          const retryable =
            code === 'auth/user-not-found' ||
            code === 'auth/wrong-password' ||
            code === 'auth/invalid-credential' ||
            code === 'auth/invalid-login-credentials';
          if (!fromCache || !retryable) throw error;
          this.clearCachedLoginEmail(emp);
          const fresh = await this.resolveLoginEmailForSignIn(emp, true);
          if (!fresh || fresh === email) throw error;
          email = fresh;
          await this.authService.signIn(email, this.authService.authPasswordFor(pass));
        }
        this.showMessage(
          this.currentLanguage === 'en' ? 'Login successful!' : 'Đăng nhập thành công!', 
          'success'
        );
        this.clearLoginFields();
        this.navigateAfterLogin();
      } catch (error: any) {
        this.showMessage(this.getErrorMessage(error), 'error');
      } finally {
        this.loading = false;
      }
    }
  }

  async onSignup(): Promise<void> {
    if (!this.signupForm.valid) {
      return;
    }

    const { employeeId, fullName, department, email } = this.signupForm.value;
    const emailNorm = (email || '').trim().toLowerCase();
    const fullNameTrim = (fullName || '').trim();

    this.loading = true;
    try {
      await firstValueFrom(
        this.fns.httpsCallable('publicRegisterAspUserFn')({
          employeeId,
          fullName: fullNameTrim,
          department,
          email: emailNorm
        })
      );

      this.showMessage(
        this.currentLanguage === 'en'
          ? 'Account created. Check your email for the 6-digit password.'
          : 'Đã tạo tài khoản. Kiểm tra email để nhận mật khẩu 6 số.',
        'success'
      );
      this.isSignup = false;
      this.signupForm.reset();
      this.loginForm.patchValue({ employeeId: (employeeId || '').trim().toUpperCase(), password: '' });
    } catch (error: any) {
      const code = error?.code as string | undefined;
      const msg = (error?.message as string) || '';
      if (code === 'functions/already-exists' || msg.includes('đã được')) {
        this.showMessage(
          this.currentLanguage === 'en'
            ? 'This employee ID or email is already registered.'
            : 'Mã nhân viên hoặc email đã được đăng ký.',
          'error'
        );
        return;
      }
      if (code === 'functions/invalid-argument') {
        this.showMessage(msg || (this.currentLanguage === 'en' ? 'Invalid data.' : 'Dữ liệu không hợp lệ.'), 'error');
        return;
      }
      this.showMessage(
        this.currentLanguage === 'en'
          ? 'Registration failed. Try again or contact admin.'
          : 'Đăng ký thất bại. Thử lại hoặc liên hệ quản trị.',
        'error'
      );
    } finally {
      this.loading = false;
    }
  }

  private getErrorMessage(error: any): string {
    const messages = {
      'auth/user-not-found': {
        en: 'Employee ID not found!',
        vi: 'Mã số nhân viên không tồn tại!'
      },
      'auth/wrong-password': {
        en: 'Wrong password!',
        vi: 'Mật khẩu không đúng!'
      },
      'auth/email-already-in-use': {
        en: 'Email already in use!',
        vi: 'Email đã được sử dụng!'
      },
      'auth/weak-password': {
        en: 'Password too weak!',
        vi: 'Mật khẩu quá yếu!'
      },
      'auth/invalid-email': {
        en: 'Invalid employee ID!',
        vi: 'Mã số nhân viên không hợp lệ!'
      },
      'auth/too-many-requests': {
        en: 'Too many login attempts. This device is temporarily blocked. Wait 15–60 minutes or try another network/device.',
        vi: 'Đăng nhập quá nhiều lần. Thiết bị đang bị Firebase tạm khóa. Đợi 15–60 phút hoặc thử mạng/thiết bị khác.'
      },
      'auth/invalid-credential': {
        en: 'Wrong employee ID or password!',
        vi: 'Mã hoặc mật khẩu không đúng!'
      },
      'auth/invalid-login-credentials': {
        en: 'Wrong employee ID or password!',
        vi: 'Mã hoặc mật khẩu không đúng!'
      },
      'functions/permission-denied': {
        en: 'Wrong employee ID or password!',
        vi: 'Mã hoặc mật khẩu không đúng!'
      },
      'functions/internal': {
        en: 'Login service error. Please try again.',
        vi: 'Lỗi dịch vụ đăng nhập. Vui lòng thử lại.'
      }
    };

    const errorMessages = messages[error.code as keyof typeof messages];
    if (errorMessages) {
      return errorMessages[this.currentLanguage];
    }
    
    return this.currentLanguage === 'en' ? 'An error occurred. Please try again!' : 'Có lỗi xảy ra, vui lòng thử lại!';
  }

  private clearLoginFields(): void {
    this.loginForm.reset({ employeeId: '', password: '' });
  }

  private showMessage(message: string, type: 'success' | 'error'): void {
    this.snackBar.open(message, this.currentLanguage === 'en' ? 'Close' : 'Đóng', {
      duration: 3000,
      panelClass: type === 'success' ? ['success-snackbar'] : ['error-snackbar']
    });
  }

  toggleMode(): void {
    this.isSignup = !this.isSignup;
    this.scanReady = false;
  }

  openLoginCamera(): void {
    if (this.loading || this.isSignup) return;
    const ref = this.dialog.open(QRScannerModalComponent, {
      data: {
        title: this.currentLanguage === 'en' ? 'Scan' : 'Quét',
        message: this.currentLanguage === 'en' ? 'Point the camera at the code' : 'Hướng camera vào mã'
      },
      panelClass: 'qr-scanner-dialog-panel',
      maxWidth: '95vw',
      width: '420px'
    });
    ref.afterClosed().subscribe((result) => {
      if (result?.success && result?.text) {
        void this.completeScanLogin(String(result.text));
      }
    });
  }

  armLoginScanner(): void {
    if (this.loading || this.isSignup) return;
    this.scanReady = true;
    setTimeout(() => {
      const el = this.loginScanInput?.nativeElement;
      if (!el) return;
      el.value = '';
      el.focus();
    }, 0);
  }

  onLoginScanEnter(event: Event): void {
    event.preventDefault();
    const el = event.target as HTMLInputElement;
    const value = el.value;
    el.value = '';
    void this.completeScanLogin(value);
  }

  private async completeScanLogin(raw: string): Promise<void> {
    const payload = String(raw || '').trim();
    if (!payload || this.loading) return;
    this.loading = true;
    try {
      const result = await firstValueFrom(this.fns.httpsCallable('scanLoginFn')({ payload }));
      const data = (result as { data?: { token?: string } })?.data ?? (result as { token?: string });
      const token = typeof data?.token === 'string' ? data.token : '';
      if (!token) {
        this.showMessage(
          this.currentLanguage === 'en' ? 'Could not sign in.' : 'Không đăng nhập được.',
          'error'
        );
        return;
      }
      await this.authService.signInWithCustomToken(token);
      this.showMessage(
        this.currentLanguage === 'en' ? 'Login successful!' : 'Đăng nhập thành công!',
        'success'
      );
      this.clearLoginFields();
      this.scanReady = false;
      this.navigateAfterLogin();
    } catch (error: any) {
      this.showMessage(this.getErrorMessage(error), 'error');
    } finally {
      this.loading = false;
    }
  }

  setLanguage(lang: 'en' | 'vi'): void {
    this.currentLanguage = lang;
    // Lưu ngôn ngữ vào localStorage để duy trì khi refresh
    localStorage.setItem('preferredLanguage', lang);
  }
} 