/**
 * Thông báo dạng toast thay cho alert() của trình duyệt.
 *
 * - Không chặn màn hình: đang quét liên tục không phải bấm OK.
 * - Tự nhận loại theo nội dung: lỗi (đỏ + bíp), thành công (xanh), cảnh báo (vàng), thông tin (xám).
 * - Hiện ở góc dưới, không che hàng nút đầu trang.
 * - Thông báo dài (bảng kê, nhiều dòng) giữ lại đến khi bấm ✕; thông báo ngắn tự tắt.
 * - Esc đóng tất cả. Cùng một nội dung lặp lại → gộp, hiện số lần ×N.
 *
 * Dùng: appAlert('Đã lưu') — y như alert(). Muốn chỉ định loại: appToast(msg, 'error').
 */

export type ToastType = 'error' | 'success' | 'warn' | 'info';

const HOST_ID = 'app-toast-host';
const MAX_TOASTS = 4;
const STYLE_ID = 'app-toast-style';

interface ToastEntry {
  el: HTMLElement;
  key: string;
  count: number;
  timer?: ReturnType<typeof setTimeout>;
}

const entries: ToastEntry[] = [];
let audioCtx: AudioContext | null = null;

function classify(msg: string): ToastType {
  const s = msg.toLowerCase();
  if (/❌|⛔|🚫|lỗi|error|thất bại|failed|không thể|không được|không tìm thấy|không hợp lệ|sai |sai$|từ chối|chặn|denied|invalid/.test(s)) {
    return 'error';
  }
  if (/⚠|cảnh báo|warning|lưu ý|chú ý|vui lòng|hãy |chưa /.test(s)) return 'warn';
  if (/✅|✔|thành công|success|đã lưu|đã xóa|đã cập nhật|đã tạo|đã gửi|đã copy|hoàn tất|xong/.test(s)) return 'success';
  return 'info';
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
#${HOST_ID}{position:fixed;right:16px;bottom:16px;z-index:100003;display:flex;flex-direction:column-reverse;gap:8px;
  max-width:min(440px,calc(100vw - 32px));pointer-events:none;font-family:var(--app-font,Arial,sans-serif)}
@media (max-width:600px){#${HOST_ID}{left:12px;right:12px;bottom:12px;max-width:none}}
.app-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:6px;
  background:#fff;color:#1f2937;border:1px solid #d1d5db;border-left:4px solid #6b7280;
  box-shadow:0 4px 14px rgba(0,0,0,.12);font-size:14px;line-height:1.4;animation:app-toast-in .15s ease-out}
.app-toast--error{border-left-color:#dc2626;background:#fef2f2}
.app-toast--success{border-left-color:#16a34a;background:#f0fdf4}
.app-toast--warn{border-left-color:#d97706;background:#fffbeb}
.app-toast__msg{flex:1;white-space:pre-wrap;word-break:break-word;max-height:50vh;overflow:auto;user-select:text}
.app-toast__count{font-weight:700;margin-left:4px;color:#6b7280}
.app-toast__close{border:0;background:transparent;cursor:pointer;font-size:16px;line-height:1;color:#6b7280;padding:2px 4px}
.app-toast__close:hover{color:#111827}
@keyframes app-toast-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
`;
  document.head.appendChild(st);
}

function getHost(): HTMLElement {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    ensureStyle();
    host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && entries.length) dismissAll();
    });
  }
  return host;
}

function beep(): void {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    const ctx = audioCtx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.value = 0.06;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch { /* trình duyệt chặn âm thanh — bỏ qua */ }
  try { navigator.vibrate?.(150); } catch { /* bỏ qua */ }
}

function remove(entry: ToastEntry): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.el.remove();
  const i = entries.indexOf(entry);
  if (i >= 0) entries.splice(i, 1);
}

function dismissAll(): void {
  [...entries].forEach(remove);
}

function schedule(entry: ToastEntry, msg: string, type: ToastType): void {
  if (entry.timer) clearTimeout(entry.timer);
  const lines = msg.split('\n').length;
  const sticky = msg.length > 260 || lines > 5;
  if (sticky) return;
  const base = type === 'error' ? 7000 : type === 'warn' ? 5500 : 3500;
  const ms = Math.min(12000, base + msg.length * 35);
  entry.timer = setTimeout(() => remove(entry), ms);
}

function toText(message: unknown): string {
  if (message == null) return '';
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  try { return typeof message === 'object' ? JSON.stringify(message) : String(message); } catch { return String(message); }
}

/** Hiện toast. type bỏ trống → tự đoán theo nội dung. */
export function appToast(message: unknown, type?: ToastType): void {
  const msg = toText(message);
  if (typeof document === 'undefined' || !document.body) {
    console.warn(msg);
    return;
  }
  const t = type || classify(msg);
  const key = t + '|' + msg;

  const existing = entries.find((e) => e.key === key);
  if (existing) {
    existing.count++;
    const c = existing.el.querySelector('.app-toast__count');
    if (c) c.textContent = `×${existing.count}`;
    schedule(existing, msg, t);
    if (t === 'error') beep();
    return;
  }

  const host = getHost();
  const el = document.createElement('div');
  el.className = `app-toast app-toast--${t}`;
  el.setAttribute('role', t === 'error' ? 'alert' : 'status');

  const text = document.createElement('div');
  text.className = 'app-toast__msg';
  text.textContent = msg;
  const count = document.createElement('span');
  count.className = 'app-toast__count';
  text.appendChild(count);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'app-toast__close';
  close.setAttribute('aria-label', 'Đóng');
  close.textContent = '✕';

  el.appendChild(text);
  el.appendChild(close);
  host.appendChild(el);

  const entry: ToastEntry = { el, key, count: 1 };
  close.addEventListener('click', () => remove(entry));
  // Rê chuột vào thì dừng đếm giờ để kịp đọc.
  el.addEventListener('mouseenter', () => { if (entry.timer) clearTimeout(entry.timer); });
  el.addEventListener('mouseleave', () => schedule(entry, msg, t));
  entries.push(entry);
  schedule(entry, msg, t);

  while (entries.length > MAX_TOASTS) remove(entries[0]);
  if (t === 'error') beep();
}

/** Thay thế trực tiếp cho alert(): cùng chữ ký, không chặn màn hình. */
export function appAlert(message?: unknown): void {
  appToast(message);
}

// Để thử nhanh trong console: appToast('Lỗi ...')
if (typeof window !== 'undefined') (window as any).appToast = appToast;
