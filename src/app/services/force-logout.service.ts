import { Injectable, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Subscription } from 'rxjs';
import firebase from 'firebase/compat/app';

const SESSION_KEY = 'authSessionStartedAt';

interface ForceLogoutDoc {
  logoutAfter?: firebase.firestore.Timestamp | null;
}

/** Gọi ngay sau khi đăng nhập thành công — lưu mốc bắt đầu phiên để so sánh với lần buộc đăng xuất kế tiếp. */
export function markAuthSessionStarted(): void {
  try {
    localStorage.setItem(SESSION_KEY, String(Date.now()));
  } catch {
    /* ignore quota */
  }
}

/**
 * Buộc đăng xuất toàn bộ trình duyệt 1 lần/ngày lúc 6h (Asia/Ho_Chi_Minh) — xem
 * functions/src/force-logout.ts. Cloud Function chỉ ghi 1 timestamp vào
 * `app-settings/force-logout`; ở đây so sánh timestamp đó với mốc đăng nhập đã lưu
 * (`markAuthSessionStarted`) — phiên nào đăng nhập TRƯỚC mốc buộc đăng xuất mới nhất
 * sẽ bị đăng xuất, phiên đăng nhập SAU mốc đó (ví dụ đăng nhập lại sau 6h) không bị ảnh hưởng.
 * Dùng 1 listener realtime trên 1 doc duy nhất (giống ClientReloadService) — chỉ 1 read/máy
 * lúc mở app + 1 read/máy mỗi lần Cloud Function chạy (1 lần/ngày), không tốn thêm gì khác.
 */
@Injectable({
  providedIn: 'root'
})
export class ForceLogoutService implements OnDestroy {
  private static readonly DOC_PATH = 'app-settings/force-logout';
  private subscription: Subscription | null = null;
  private listening = false;

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth
  ) {}

  startListening(): void {
    if (this.listening) {
      return;
    }
    this.listening = true;

    this.subscription = this.firestore
      .doc<ForceLogoutDoc>(ForceLogoutService.DOC_PATH)
      .valueChanges()
      .subscribe({
        next: (data) => {
          const logoutAfterMs = data?.logoutAfter?.toMillis?.() ?? 0;
          if (!logoutAfterMs) {
            return;
          }

          const stored = localStorage.getItem(SESSION_KEY);
          if (stored === null) {
            // Chưa từng lưu mốc đăng nhập (VD: phiên có từ trước khi tính năng này tồn tại)
            // — coi như phiên vừa bắt đầu, không đăng xuất ngay lần đầu thấy tính năng.
            markAuthSessionStarted();
            return;
          }

          const sessionStartedAt = Number(stored);
          if (Number.isFinite(sessionStartedAt) && logoutAfterMs > sessionStartedAt) {
            localStorage.removeItem(SESSION_KEY);
            void this.afAuth.signOut().finally(() => {
              window.location.href = '/login';
            });
          }
        },
        error: (err) => {
          console.error('ForceLogoutService: listen failed', err);
        }
      });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.listening = false;
  }
}
