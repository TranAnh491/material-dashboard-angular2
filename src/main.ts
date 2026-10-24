/*!

=========================================================
* Material Dashboard Angular - v2.8.0
=========================================================

* Product Page: https://www.creative-tim.com/product/material-dashboard-angular2
* Copyright 2021 Creative Tim (https://www.creative-tim.com)
* Licensed under MIT (https://github.com/creativetimofficial/material-dashboard-angular2/blob/master/LICENSE.md)

* Coded by Creative Tim

=========================================================

* The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

*/
import { enableProdMode } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { environment } from './environments/environment';
import 'hammerjs';
import 'firebase/compat/storage';

if (environment.production) {
  enableProdMode();
}

/**
 * Máy còn giữ trang của bản cũ mà file JS của bản đó đã bị thay khi deploy → lỗi "Loading chunk …".
 * Tự tải lại trang 1 lần (tối đa 1 lần / 60 giây) để lấy bản mới nhất.
 */
function reloadOnStaleChunk(reason: unknown): void {
  const msg = String((reason as any)?.message || reason || '');
  if (!/ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module/i.test(msg)) return;
  try {
    const last = Number(sessionStorage.getItem('stale-chunk-reload-at')) || 0;
    if (Date.now() - last < 60000) return;
    sessionStorage.setItem('stale-chunk-reload-at', String(Date.now()));
  } catch { /* sessionStorage bị chặn — vẫn tải lại */ }
  window.location.reload();
}
window.addEventListener('unhandledrejection', (e) => reloadOnStaleChunk(e.reason));
window.addEventListener('error', (e) => reloadOnStaleChunk((e as ErrorEvent).error || (e as ErrorEvent).message));

platformBrowserDynamic().bootstrapModule(AppModule);
