import { Injectable } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom } from 'rxjs';

export interface ReadyPhotoNoticePayload {
  lsx: string;
  line: string;
  factory: string;
  productCode: string;
  /** Team soạn (cột Người soạn → team). */
  team: string;
  /** Tên người soạn (Tình, Tuấn…) — server khớp với tên trong zalo_links. */
  names: string[];
  /** Mã ASP người scan xuất (nếu có). */
  memberIds: string[];
}

/** LSX Ready ở Line cần chụp hình (WHA/WHB/WHG/WHH, USB C) → Zalo riêng cho team soạn. */
@Injectable({ providedIn: 'root' })
export class ReadyPhotoZaloService {
  constructor(private fns: AngularFireFunctions) {}

  async notify(payload: ReadyPhotoNoticePayload): Promise<{ sentTo: string[]; skipped: boolean }> {
    const callable = this.fns.httpsCallable<ReadyPhotoNoticePayload, { ok: boolean; sentTo?: string[]; skipped?: boolean }>(
      'notifyReadyPhotoRequiredFn'
    );
    const res = await firstValueFrom(callable(payload));
    return { sentTo: res?.sentTo || [], skipped: !!res?.skipped };
  }
}
