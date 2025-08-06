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
  currentLanguage: 'en' | 'vi' = 'vi'; // Default to Vietnamese

  constructor(
    private fb: FormBuilder,
    private authService: FirebaseAuthService,
    private snackBar: MatSnackBar,
    private router: Router
  ) {
    this.loginForm = this.fb.group({
      employeeId: ['', [Validators.required, Validators.pattern(/^ASP\d{4}$/)]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });

    this.signupForm = this.fb.group({
      employeeId: ['', [Validators.required, Validators.pattern(/^ASP\d{4}$/)]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
      displayName: ['', [Validators.required]],
      department: ['', [Validators.required]],
      factory: ['', [Validators.required]],
      role: ['User', [Validators.required]]
    });
  }

  ngOnInit(): void {
    // Load ngôn ngữ từ localStorage
    const savedLanguage = localStorage.getItem('preferredLanguage');
    if (savedLanguage === 'en' || savedLanguage === 'vi') {
      this.currentLanguage = savedLanguage;
    }

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
        const { employeeId, password } = this.loginForm.value;
        
        // Xử lý tài khoản đặc biệt Steve
        if (employeeId === 'Steve' && password === '999') {
          await this.authService.signInSpecialUser('Steve', 'steve@asp.com');
          this.showMessage(
            this.currentLanguage === 'en' ? 'Login successful!' : 'Đăng nhập thành công!', 
            'success'
          );
          this.router.navigate(['/dashboard']);
          return;
        }


        
        // Chuyển đổi mã số nhân viên thành email để đăng nhập
        const email = `${employeeId}@asp.com`;
        await this.authService.signIn(email, password);
        this.showMessage(
          this.currentLanguage === 'en' ? 'Login successful!' : 'Đăng nhập thành công!', 
          'success'
        );
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
      const { employeeId, password, confirmPassword, displayName, department, factory, role } = this.signupForm.value;
      
      if (password !== confirmPassword) {
        this.showMessage(
          this.currentLanguage === 'en' ? 'Password confirmation does not match!' : 'Mật khẩu xác nhận không khớp!', 
          'error'
        );
        return;
      }

      this.loading = true;
      try {
        // Chuyển đổi mã số nhân viên thành email để đăng ký
        const email = `${employeeId}@asp.com`;
        await this.authService.signUp(email, password, displayName, department, factory, role);
        this.showMessage(
          this.currentLanguage === 'en' ? 'Registration successful!' : 'Đăng ký thành công!', 
          'success'
        );
        this.isSignup = false;
        this.loginForm.patchValue({ employeeId });
      } catch (error: any) {
        this.showMessage(this.getErrorMessage(error), 'error');
      } finally {
        this.loading = false;
      }
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
        en: 'Employee ID already in use!',
        vi: 'Mã số nhân viên đã được sử dụng!'
      },
      'auth/weak-password': {
        en: 'Password too weak!',
        vi: 'Mật khẩu quá yếu!'
      },
      'auth/invalid-email': {
        en: 'Invalid employee ID!',
        vi: 'Mã số nhân viên không hợp lệ!'
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