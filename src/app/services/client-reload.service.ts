import { Injectable, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subscription } from 'rxjs';

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
      .subscribe((data) => {
        const token = Number(data?.reloadToken ?? 0);
        if (!Number.isFinite(token) || token <= 0) {
          return;
        }

        const stored = sessionStorage.getItem(ClientReloadService.STORAGE_KEY);
        if (stored === null) {
          sessionStorage.setItem(ClientReloadService.STORAGE_KEY, String(token));
          return;
        }

        const lastToken = Number(stored);
        if (token !== lastToken) {
          sessionStorage.setItem(ClientReloadService.STORAGE_KEY, String(token));
          window.location.reload();
        }
      });
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
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.listening = false;
  }
}
