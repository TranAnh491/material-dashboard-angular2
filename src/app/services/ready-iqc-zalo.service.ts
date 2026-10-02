import { Injectable } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom } from 'rxjs';

export interface ReadyIqcNoticeItem {
  materialCode: string;
  po: string;
  location: string;
  iqcStatus: string;
}

@Injectable({ providedIn: 'root' })
export class ReadyIqcZaloService {
  constructor(private fns: AngularFireFunctions) {}

  async notify(payload: {
    lsx: string;
    factory: string;
    items: ReadyIqcNoticeItem[];
  }): Promise<void> {
    const callable = this.fns.httpsCallable<typeof payload, { ok: boolean }>(
      'notifyReadyIqcWaitingFn'
    );
    await firstValueFrom(callable(payload));
  }
}
