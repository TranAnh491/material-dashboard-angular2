import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
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

  constructor(
    private fb: FormBuilder,
    private authService: FirebaseAuthService,
    private snackBar: MatSnackBar,
    private router: Router
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });

    this.signupForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
      displayName: ['', [Validators.required]]
    });
  }

  ngOnInit(): void {
    // Kiểm tra nếu đã đăng nhập thì chuyển về dashboard
    this.authService.isAuthenticated.subscribe(isAuth => {
      if (isAuth) {
        this.router.navigate(['/dashboard']);
      }
    });
  }

  async onLogin(): Promise<void> {
    if (this.loginForm.valid) {
      this.loading = true;
      try {
        const { email, password } = this.loginForm.value;
        await this.authService.signIn(email, password);
        this.showMessage('Đăng nhập thành công!', 'success');
        this.router.navigate(['/dashboard']);
      } catch (error: any) {
        this.showMessage(this.getErrorMessage(error), 'error');
      } finally {
        this.loading = false;
      }
    }
  }

  async onSignup(): Promise<void> {
    if (this.signupForm.valid) {
      const { email, password, confirmPassword, displayName } = this.signupForm.value;
      
      if (password !== confirmPassword) {
        this.showMessage('Mật khẩu xác nhận không khớp!', 'error');
        return;
      }

      this.loading = true;
      try {
        await this.authService.signUp(email, password, displayName);
        this.showMessage('Đăng ký thành công!', 'success');
        this.isSignup = false;
        this.loginForm.patchValue({ email });
      } catch (error: any) {
        this.showMessage(this.getErrorMessage(error), 'error');
      } finally {
        this.loading = false;
      }
    }
  }

  private getErrorMessage(error: any): string {
    switch (error.code) {
      case 'auth/user-not-found':
        return 'Email không tồn tại!';
      case 'auth/wrong-password':
        return 'Mật khẩu không đúng!';
      case 'auth/email-already-in-use':
        return 'Email đã được sử dụng!';
      case 'auth/weak-password':
        return 'Mật khẩu quá yếu!';
      case 'auth/invalid-email':
        return 'Email không hợp lệ!';
      default:
        return 'Có lỗi xảy ra, vui lòng thử lại!';
    }
  }

  private showMessage(message: string, type: 'success' | 'error'): void {
    this.snackBar.open(message, 'Đóng', {
      duration: 3000,
      panelClass: type === 'success' ? ['success-snackbar'] : ['error-snackbar']
    });
  }

  toggleMode(): void {
    this.isSignup = !this.isSignup;
  }
} 