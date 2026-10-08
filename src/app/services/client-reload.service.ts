import { Injectable, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { BehaviorSubject, Subscription } from 'rxjs';

interface ClientReloadDoc {
  reloadToken?: number;
  requestedAt?: unknown;
  requestedBy?: string;
  message?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ClientReloadService implements OnDestroy {
  private static readonly DOC_PATH = 'app-settings/client-reload';
  private static readonly STORAGE_KEY = 'clientReloadToken';
  private subscription: Subscription | null = null;
  private listening = false;

  /**
   * true khi có bản mới cần tải lại. KHÔNG tự động reload() ngay — để không cắt ngang thao tác
   * đang dở (gõ form, quét mã...). UI (app.component) hiển thị popup toàn màn hình, bắt buộc bấm
   * "Tải lại" mới dùng tiếp được — người dùng tự nhiên chỉ gặp popup sau khi thao tác hiện tại
   * xong (thao tác tiếp theo sẽ chạm ngay popup).
   */
  private readonly updateAvailableSubject = new BehaviorSubject<boolean>(false);
  readonly updateAvailable$ = this.updateAvailableSubject.asObservable();

  /**
   * Trang đang làm dở (VD: Outbound đang scan 1 LSX) đăng ký hold → popup tải lại chờ tới khi
   * mọi hold trả về false, tránh F5 giữa chừng làm hỏng phiên scan.
   */
  private readonly holds = new Map<string, () => boolean>();
  private holdTimer: ReturnType<typeof setInterval> | null = null;
  private readonly showPromptSubject = new BehaviorSubject<boolean>(false);
  readonly showPrompt$ = this.showPromptSubject.asObservable();

  constructor(private firestore: AngularFirestore) {}

  /** Lắng nghe realtime — gọi 1 lần khi app khởi động */
  startListening(): void {
    if (this.listening) {
      return;
    }
    this.listening = true;

    this.subscription = this.firestore
      .doc<ClientReloadDoc>(ClientReloadService.DOC_PATH)
      .valueChanges()
      .subscribe({
        next: (data) => {
          const rawToken = Number(data?.reloadToken ?? 0);
          const token = Number.isFinite(rawToken) ? rawToken : 0;

          // 🔧 FIX: Lưu baseline ngay từ lần nhận dữ liệu ĐẦU TIÊN — kể cả khi token = 0
          // (document chưa từng tồn tại). Trước đây token<=0 bị return sớm, không lưu baseline,
          // nên lần bấm "F5 tất cả" ĐẦU TIÊN (0 -> 1) luôn bị hiểu nhầm là "lần đầu thấy dữ liệu"
          // và bỏ qua, không báo — phải bấm lần 2 mới có tác dụng.
          const stored = sessionStorage.getItem(ClientReloadService.STORAGE_KEY);
          if (stored === null) {
            sessionStorage.setItem(ClientReloadService.STORAGE_KEY, String(token));
            return;
          }

          const lastToken = Number(stored);
          if (token > 0 && token !== lastToken) {
            sessionStorage.setItem(ClientReloadService.STORAGE_KEY, String(token));
            this.updateAvailableSubject.next(true);
            this.evaluatePrompt();
          }
        },
        error: (err) => {
          console.error('ClientReloadService: listen failed', err);
        }
      });
  }

  setHold(key: string, isBusy: () => boolean): void {
    this.holds.set(key, isBusy);
  }

  clearHold(key: string): void {
    this.holds.delete(key);
    this.evaluatePrompt();
  }

  private isHeld(): boolean {
    for (const isBusy of this.holds.values()) {
      try {
        if (isBusy()) return true;
      } catch { /* bỏ qua hold lỗi */ }
    }
    return false;
  }

  private evaluatePrompt(): void {
    if (!this.updateAvailableSubject.value || this.showPromptSubject.value) return;
    if (this.isHeld()) {
      if (!this.holdTimer) this.holdTimer = setInterval(() => this.evaluatePrompt(), 1000);
      return;
    }
    this.stopHoldTimer();
    this.showPromptSubject.next(true);
  }

  private stopHoldTimer(): void {
    if (this.holdTimer) clearInterval(this.holdTimer);
    this.holdTimer = null;
  }

  /** Gọi từ nút "Tải lại ngay" trên popup bắt buộc. */
  reloadNow(): void {
    window.location.reload();
  }

  /** Admin bấm → tăng token → mọi tab đang mở web sẽ F5 */
  async requestReloadAll(requestedBy = 'ADMIN', message = ''): Promise<number> {
    const ref = this.firestore.doc<ClientReloadDoc>(ClientReloadService.DOC_PATH);
    const snap = await ref.get().toPromise();
    const current = Number((snap?.data() as ClientReloadDoc | undefined)?.reloadToken ?? 0);
    const nextToken = (Number.isFinite(current) ? current : 0) + 1;

    await ref.set(
      {
        reloadToken: nextToken,
        requestedAt: new Date(),
        requestedBy,
        message: message || 'Admin yêu cầu làm mới toàn bộ trình duyệt'
      },
      { merge: true }
    );

    return nextToken;
  }

  ngOnDestroy(): void {
    this.stopHoldTimer();
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.listening = false;
  }
}
