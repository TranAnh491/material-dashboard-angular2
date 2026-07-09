import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom } from 'rxjs';
import { FirebaseAuthService } from '../../services/firebase-auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {
  loginForm: FormGroup;
  signupForm: FormGroup;
  isSignup = false;
  loading = false;
  currentLanguage: 'en' | 'vi' = 'vi'; // Default to Vietnamese

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
  }

  constructor(
    private fb: FormBuilder,
    private authService: FirebaseAuthService,
    private snackBar: MatSnackBar,
    private router: Router,
    private fns: AngularFireFunctions
  ) {
    /** Đăng nhập: ASP + 4 số hoặc XETAI (app phụ xe tải). */
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
  private async resolveLoginEmailForSignIn(employeeId: string): Promise<string> {
    const upper = (employeeId || '').trim().toUpperCase();
    if (!/^ASP\d{4}$/.test(upper)) {
      return this.loginFieldToEmail(employeeId);
    }
    try {
      const result = await firstValueFrom(
        this.fns.httpsCallable('lookupAuthLoginEmailByEmployeeIdFn')({ employeeId: upper })
      );
      const payload = (result as { data?: { email?: string | null } })?.data ?? (result as { email?: string | null });
      const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : '';
      if (email) {
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
  }

  /** Sau đăng nhập: app phụ Xe Tải → /xe-tai, app chính → /menu */
  private navigateAfterLogin(): void {
    const menuRoute = this.router.config.find((r) => r.path === 'menu');
    const toXeTai = !!(menuRoute && (menuRoute as { redirectTo?: string }).redirectTo === 'xe-tai');
    this.router.navigate([toXeTai ? '/xe-tai' : '/menu']);
  }

  private isTruckDriverLogin(employeeId: string): boolean {
    return String(employeeId || '').trim().toUpperCase() === 'XETAI';
  }

  private async signInTruckDriver(employeeId: string, password: string): Promise<void> {
    const result = await firstValueFrom(
      this.fns.httpsCallable('truckDriverSignInFn')({ employeeId, password })
    );
    const payload =
      (result as { data?: { email?: string } })?.data ?? (result as { email?: string });
    const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : 'xetai@asp.com';
    await this.authService.signIn(email, password);
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
          this.navigateAfterLogin();
          return;
        }

        // Tài xế app phụ Xe Tải: XETAI / 1234
        if (this.isTruckDriverLogin(emp)) {
          if (pass.length < 4) {
            this.showMessage(
              this.currentLanguage === 'en' ? 'Password must be at least 4 characters' : 'Mật khẩu phải có ít nhất 4 ký tự',
              'error'
            );
            return;
          }
          await this.signInTruckDriver(emp, pass);
          this.showMessage(
            this.currentLanguage === 'en' ? 'Login successful!' : 'Đăng nhập thành công!',
            'success'
          );
          this.navigateAfterLogin();
          return;
        }

        if (pass.length < 6) {
          this.showMessage(
            this.currentLanguage === 'en' ? 'Password must be at least 6 characters' : 'Mật khẩu phải có ít nhất 6 ký tự',
            'error'
          );
          return;
        }
        
        const email = await this.resolveLoginEmailForSignIn(emp);
        await this.authService.signIn(email, pass);
        this.showMessage(
          this.currentLanguage === 'en' ? 'Login successful!' : 'Đăng nhập thành công!', 
          'success'
        );
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

  private showMessage(message: string, type: 'success' | 'error'): void {
    this.snackBar.open(message, this.currentLanguage === 'en' ? 'Close' : 'Đóng', {
      duration: 3000,
      panelClass: type === 'success' ? ['success-snackbar'] : ['error-snackbar']
    });
  }

  toggleMode(): void {
    this.isSignup = !this.isSignup;
  }

  setLanguage(lang: 'en' | 'vi'): void {
    this.currentLanguage = lang;
    // Lưu ngôn ngữ vào localStorage để duy trì khi refresh
    localStorage.setItem('preferredLanguage', lang);
  }
} 