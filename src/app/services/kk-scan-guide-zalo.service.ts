import { Injectable } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class KkScanGuideZaloService {
  constructor(private fns: AngularFireFunctions) {}

  sendToKhoGroup(sentBy?: string): Promise<{ ok: boolean; images: number }> {
    const callable = this.fns.httpsCallable<
      { sentBy?: string },
      { ok: boolean; images: number }
    >('sendKkScanGuideToKhoGroupFn');
    return firstValueFrom(callable({ sentBy: sentBy || '' }));
  }
}
