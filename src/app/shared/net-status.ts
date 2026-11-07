import { appToast } from './app-toast';

/**
 * Báo trạng thái mạng cho người dùng (không cần sửa từng tab).
 *
 * - Mất mạng: hiện dải đỏ nhỏ ở góc dưới bên trái (không che hàng nút đầu trang).
 *   Firestore vẫn giữ các lệnh ghi trong bộ nhớ và tự gửi khi có mạng lại —
 *   NHƯNG nếu tải lại / đóng trang lúc đang mất mạng thì mất. Vì vậy khi offline
 *   trình duyệt sẽ hỏi lại trước khi rời trang.
 * - Có mạng lại: toast xanh "Đã có mạng lại".
 *
 * Không bật cache IndexedDB của Firestore: nhiều chỗ đọc 1 lần (firstValueFrom/take(1))
 * sẽ nhận số tồn từ cache cũ → sai số liệu kho.
 */
let installed = false;

export function installNetStatus(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const style = document.createElement('style');
  style.textContent = `
#app-net-banner{position:fixed;left:16px;bottom:16px;z-index:100001;display:none;align-items:center;gap:8px;
  padding:8px 12px;border-radius:6px;background:#b91c1c;color:#fff;font:600 13px var(--app-font,Arial,sans-serif);
  box-shadow:0 4px 14px rgba(0,0,0,.18);max-width:calc(100vw - 32px)}
#app-net-banner.show{display:flex}
#app-net-banner .material-icons{font-size:18px}
@media (max-width:600px){#app-net-banner{left:12px;right:12px;bottom:auto;top:8px}}
`;
  document.head.appendChild(style);

  const banner = document.createElement('div');
  banner.id = 'app-net-banner';
  banner.setAttribute('role', 'alert');
  banner.innerHTML =
    '<i class="material-icons">wifi_off</i>' +
    '<span>Mất mạng — dữ liệu sẽ tự gửi khi có mạng lại. Đừng tải lại / đóng trang.</span>';

  const mount = () => document.body.appendChild(banner);
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });

  const beforeUnload = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = '';
  };

  const update = (announce: boolean) => {
    const online = navigator.onLine;
    banner.classList.toggle('show', !online);
    if (online) {
      window.removeEventListener('beforeunload', beforeUnload);
      if (announce) appToast('✅ Đã có mạng lại — dữ liệu đang được gửi lên.', 'success');
    } else {
      window.addEventListener('beforeunload', beforeUnload);
    }
  };

  window.addEventListener('online', () => update(true));
  window.addEventListener('offline', () => update(true));
  update(false);
}
