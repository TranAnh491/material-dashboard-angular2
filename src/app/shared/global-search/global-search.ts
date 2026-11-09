import { Injector, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { APP_TABS, AppTab } from '../../routes/app-tabs';

/**
 * Tìm kiếm toàn app — bấm Ctrl+K (Mac: ⌘K) ở bất kỳ tab nào.
 *
 * - Gõ tên tab (vd "outbound", "vị trí") → Enter / bấm để mở tab.
 * - Gõ mã NVL (vd B001234) → tra tồn kho RM ngay: nhà máy, PO, IMD, vị trí, số tồn.
 *   Chỉ 1 truy vấn (limit 100) mỗi lần tra, không đọc cả collection.
 *
 * Gắn 1 lần trong main.ts sau khi bootstrap; không cần sửa từng tab.
 */

interface StockRow {
  factory: string;
  poNumber: string;
  batch: string;
  location: string;
  stock: number;
  unit: string;
  name: string;
}

let installed = false;

export function installGlobalSearch(injector: Injector): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  const router = injector.get(Router);
  const zone = injector.get(NgZone);
  const afs = injector.get(AngularFirestore);

  injectStyle();

  let overlay: HTMLElement | null = null;
  let input: HTMLInputElement;
  let list: HTMLElement;
  let stockBox: HTMLElement;
  let tabHits: AppTab[] = [];
  let active = 0;
  let searchSeq = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  const close = () => {
    overlay?.remove();
    overlay = null;
  };

  const go = (tab: AppTab | undefined) => {
    if (!tab) return;
    close();
    zone.run(() => void router.navigateByUrl(tab.path));
  };

  const renderTabs = () => {
    list.innerHTML = '';
    tabHits.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'gs-item' + (i === active ? ' is-active' : '');
      const icon = t.menu?.icon || t.sidebarIcon || 'tab';
      row.innerHTML = `<i class="material-icons">${/^[a-z_]+$/.test(icon) ? icon : 'tab'}</i>`;
      const txt = document.createElement('div');
      txt.className = 'gs-item__txt';
      const title = document.createElement('b');
      title.textContent = t.title;
      const sub = document.createElement('span');
      sub.textContent = t.subtitle || t.path;
      txt.appendChild(title);
      txt.appendChild(sub);
      row.appendChild(txt);
      row.addEventListener('mouseenter', () => { active = i; markActive(); });
      row.addEventListener('click', () => go(t));
      list.appendChild(row);
    });
    if (!tabHits.length) {
      list.innerHTML = '<div class="gs-empty">Không có tab khớp</div>';
    }
  };

  const markActive = () => {
    list.querySelectorAll('.gs-item').forEach((el, i) => el.classList.toggle('is-active', i === active));
  };

  const filterTabs = (q: string) => {
    const nq = norm(q);
    const seen = new Set<string>();
    tabHits = APP_TABS.filter((t) => {
      if (seen.has(t.path) || (!t.menu && !t.sidebarIcon && !t.dashboard)) return false;
      const hay = norm(`${t.title} ${t.subtitle || ''} ${t.path}`);
      const ok = !nq || nq.split(' ').every((w) => hay.includes(w));
      if (ok) seen.add(t.path);
      return ok;
    }).slice(0, 8);
    active = 0;
    renderTabs();
  };

  const lookupStock = async (raw: string) => {
    const code = raw.trim().toUpperCase();
    const seq = ++searchSeq;
    if (!/^[A-Z0-9][A-Z0-9._-]{3,}$/.test(code) || !/\d/.test(code)) {
      stockBox.innerHTML = '';
      return;
    }
    stockBox.innerHTML = `<div class="gs-muted">Đang tra tồn kho mã <b>${esc(code)}</b>…</div>`;
    try {
      const snap = await afs.firestore
        .collection('inventory-materials')
        .where('materialCode', '==', code)
        .limit(100)
        .get();
      if (seq !== searchSeq || !overlay) return;
      const rows: StockRow[] = [];
      snap.forEach((d) => {
        const m: any = d.data();
        if (m.deleteAfterAt) return; // dòng đã vào danh mục Ẩn
        const stock = (m.openingStock ?? 0) + (Number(m.quantity) || 0) - (Number(m.exported) || 0) - (Number(m.xt) || 0);
        if (Math.abs(stock) < 1e-9) return;
        rows.push({
          factory: m.factory || '',
          poNumber: m.poNumber || '',
          batch: m.batchNumber || m.importDate?.toDate?.()?.toLocaleDateString?.('vi-VN') || '',
          location: m.location || '',
          stock,
          unit: m.unit || '',
          name: m.materialName || '',
        });
      });
      renderStock(code, rows, snap.size);
    } catch (e: any) {
      if (seq !== searchSeq) return;
      stockBox.innerHTML = `<div class="gs-err">Không tra được tồn kho: ${esc(e?.message || e)}</div>`;
    }
  };

  const renderStock = (code: string, rows: StockRow[], total: number) => {
    if (!rows.length) {
      stockBox.innerHTML = `<div class="gs-muted">Mã <b>${esc(code)}</b>: ${total ? 'không còn tồn (đã xuất hết)' : 'không có trong tồn kho RM'}.</div>`;
      return;
    }
    rows.sort((a, b) => a.factory.localeCompare(b.factory) || a.location.localeCompare(b.location));
    const sum = rows.reduce((s, r) => s + r.stock, 0);
    const fmt = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
    const name = rows.find((r) => r.name)?.name || '';
    stockBox.innerHTML = `
      <div class="gs-stock-head"><b>${esc(code)}</b> ${esc(name)} — tồn <b>${fmt(sum)}</b> ${esc(rows[0].unit)} · ${rows.length} dòng</div>
      <div class="xl-scroll gs-stock-scroll">
        <table class="xl-table"><thead><tr><th>Nhà máy</th><th>PO</th><th>IMD / Batch</th><th>Vị trí</th><th>Tồn</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${esc(r.factory)}</td><td>${esc(r.poNumber)}</td><td>${esc(r.batch)}</td><td>${esc(r.location)}</td><td class="num">${fmt(r.stock)}</td></tr>`).join('')}</tbody></table>
      </div>`;
  };

  const open = (prefill = '') => {
    if (overlay) { input.focus(); input.select(); return; }
    overlay = document.createElement('div');
    overlay.className = 'gs-overlay';
    overlay.innerHTML = `
      <div class="gs-panel" role="dialog" aria-label="Tìm kiếm">
        <div class="gs-input-row">
          <i class="material-icons">search</i>
          <input type="text" placeholder="Gõ tên tab hoặc mã NVL… (Esc để đóng)" autocomplete="off" spellcheck="false">
        </div>
        <div class="gs-stock"></div>
        <div class="gs-section">Mở tab</div>
        <div class="gs-list"></div>
      </div>`;
    document.body.appendChild(overlay);
    input = overlay.querySelector('input')!;
    list = overlay.querySelector('.gs-list')!;
    stockBox = overlay.querySelector('.gs-stock')!;
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    input.addEventListener('input', () => {
      filterTabs(input.value);
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void lookupStock(input.value), 450);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { active = Math.min(active + 1, tabHits.length - 1); markActive(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); markActive(); e.preventDefault(); }
      else if (e.key === 'Enter') {
        // Enter: nếu chuỗi giống mã NVL và không có tab khớp → tra tồn ngay; ngược lại mở tab đang chọn.
        if (!tabHits.length) { if (debounce) clearTimeout(debounce); void lookupStock(input.value); }
        else go(tabHits[active]);
        e.preventDefault();
      } else if (e.key === 'Escape') { close(); e.preventDefault(); }
    });
    input.value = prefill;
    filterTabs(prefill);
    if (prefill) void lookupStock(prefill);
    input.focus();
  };

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      if (location.hash.startsWith('#/login')) return;
      e.preventDefault();
      open();
    }
  });

  (window as any).openGlobalSearch = (q?: string) => open(q || '');
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function injectStyle(): void {
  const st = document.createElement('style');
  st.textContent = `
.gs-overlay{position:fixed;inset:0;z-index:100002;background:rgba(15,23,42,.35);display:flex;justify-content:center;align-items:flex-start;padding:10vh 16px 16px}
.gs-panel{width:min(680px,100%);max-height:80vh;display:flex;flex-direction:column;background:#fff;border:1px solid var(--app-border-strong,#b7b7b7);
  border-radius:6px;box-shadow:0 12px 40px rgba(0,0,0,.25);font-family:var(--app-font,Arial,sans-serif);color:var(--app-text,#111);overflow:hidden}
.gs-input-row{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--app-border,#d0d0d0)}
.gs-input-row input{flex:1;border:0 !important;outline:0;font-size:16px;background:transparent !important}
.gs-section{padding:6px 12px;font-size:11px;font-weight:700;color:var(--app-text-muted,#64748b);background:var(--app-header-bg,#f2f2f2);text-transform:uppercase}
.gs-list{overflow:auto}
.gs-item{display:flex;align-items:center;gap:10px;padding:7px 12px;cursor:pointer;border-bottom:1px solid #f1f1f1}
.gs-item.is-active{background:#e8eefc}
.gs-item .material-icons{font-size:20px;color:var(--app-text-muted,#64748b)}
.gs-item__txt{display:flex;flex-direction:column;min-width:0}
.gs-item__txt b{font-size:14px}
.gs-item__txt span{font-size:12px;color:var(--app-text-muted,#64748b);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gs-empty,.gs-muted,.gs-err{padding:8px 12px;font-size:13px;color:var(--app-text-muted,#64748b)}
.gs-err{color:var(--app-danger,#dc2626)}
.gs-stock:empty{display:none}
.gs-stock{border-bottom:1px solid var(--app-border,#d0d0d0)}
.gs-stock-head{padding:8px 12px;font-size:13px}
.gs-stock-scroll{max-height:260px;margin:0 12px 10px}
.gs-stock-scroll table{width:100%}
`;
  document.head.appendChild(st);
}
