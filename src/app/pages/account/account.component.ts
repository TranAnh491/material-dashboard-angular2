import { Component, OnDestroy, OnInit } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import { Subscription } from 'rxjs';
import { FirebaseAuthService } from '../../services/firebase-auth.service';

@Component({
  selector: 'app-account',
  templateUrl: './account.component.html',
  styleUrls: ['./account.component.scss']
})
export class AccountComponent implements OnInit, OnDestroy {
  displayName = '';
  employeeId = '';
  email = '';
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  savingName = false;
  savingPassword = false;

  private userSub?: Subscription;
  private nameReady = false;

  constructor(
    private authService: FirebaseAuthService,
    private afAuth: AngularFireAuth,
    private firestore: AngularFirestore,
    private snackBar: MatSnackBar,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.userSub = this.authService.currentUser.subscribe((user) => {
      if (!user) return;
      this.employeeId = user.employeeId || '';
      this.email = user.email || '';
      if (!this.nameReady) {
        this.displayName = user.displayName || '';
        this.nameReady = true;
      }
    });
  }

  ngOnDestroy(): void {
    this.userSub?.unsubscribe();
  }

  backToMenu(): void {
    this.router.navigate(['/menu']);
  }

  async saveName(): Promise<void> {
    const name = this.displayName.trim();
    if (name.length < 2) {
      this.toast('Họ tên phải có ít nhất 2 ký tự');
      return;
    }
    const user = await this.afAuth.currentUser;
    if (!user) {
      this.toast('Chưa đăng nhập');
      return;
    }
    this.savingName = true;
    try {
      await user.updateProfile({ displayName: name });
      await this.firestore.doc(`users/${user.uid}`).update({
        displayName: name,
        updatedAt: new Date()
      });
      this.displayName = name;
      this.toast('Đã đổi tên');
    } catch (error) {
      console.error(error);
      this.toast('Không đổi được tên');
    } finally {
      this.savingName = false;
    }
  }

  async savePassword(): Promise<void> {
    const current = this.currentPassword.trim();
    const next = this.newPassword.trim();
    const confirm = this.confirmPassword.trim();
    if (next.length < 4) {
      this.toast('Mật khẩu mới phải có ít nhất 4 ký tự');
      return;
    }
    if (next !== confirm) {
      this.toast('Mật khẩu nhập lại chưa khớp');
      return;
    }
    const user = await this.afAuth.currentUser;
    if (!user || !user.email) {
      this.toast('Chưa đăng nhập');
      return;
    }
    this.savingPassword = true;
    try {
      const credential = firebase.auth.EmailAuthProvider.credential(
        user.email,
        this.authService.authPasswordFor(current)
      );
      await user.reauthenticateWithCredential(credential);
      await user.updatePassword(this.authService.authPasswordFor(next));
      await this.firestore.doc(`users/${user.uid}`).update({
        password: next,
        updatedAt: new Date()
      });
      this.currentPassword = '';
      this.newPassword = '';
      this.confirmPassword = '';
      this.toast('Đã đổi mật khẩu');
    } catch (error: any) {
      console.error(error);
      const code = String(error?.code || '');
      if (
        code === 'auth/wrong-password' ||
        code === 'auth/invalid-credential' ||
        code === 'auth/invalid-login-credentials'
      ) {
        this.toast('Mật khẩu hiện tại không đúng');
      } else {
        this.toast('Không đổi được mật khẩu');
      }
    } finally {
      this.savingPassword = false;
    }
  }

  private toast(message: string): void {
    this.snackBar.open(message, 'Đóng', { duration: 3000 });
  }
}
