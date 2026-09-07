import { Injectable } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of, timer } from 'rxjs';
import { mergeMap } from 'rxjs/operators';

/**
 * Chỉ preload các route được đánh dấu `data: { preload: true }`, và lùi lại một nhịp
 * để không tranh băng thông với lần tải trang đầu (mặc định 2s, chỉnh qua
 * `data: { preloadDelay: <ms> }`).
 *
 * Dùng cho các tab hay vào (materials / quan-ly-nguyen-lieu …): chunk được tải ngầm
 * sau khi app khởi động xong nên khi người dùng bấm vào tab thì mở gần như tức thì.
 */
@Injectable({ providedIn: 'root' })
export class SelectivePreloadStrategy implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (!route.data || !route.data['preload']) {
      return of(null);
    }
    const delayMs =
      typeof route.data['preloadDelay'] === 'number' ? route.data['preloadDelay'] : 2000;
    return timer(delayMs).pipe(mergeMap(() => load()));
  }
}
