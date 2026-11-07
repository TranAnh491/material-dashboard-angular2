import { appAlert } from '../../shared/app-toast';
import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { QRScannerModalComponent } from '../../components/qr-scanner-modal/qr-scanner-modal.component';
import { Router } from '@angular/router';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import firebase from 'firebase/compat/app';
import { NvlCatalogFullService } from '../../services/nvl-catalog-full.service';

/** 1 lần gọi lấy hàng */
interface JitCall { at: any; round: number; by: string; auto?: boolean }

/** Trạng thái JIT của 1 LSX — doc jit-calls/{woId} */
interface JitState {
  woId: string;
  lsx: string;
  productCode: string;
  factory: string;
  picks: boolean[];
  pickAt?: any[];
  calls: JitCall[];
  lastCallAt?: any;
  nextCallAt?: any;
  /** Sắp xếp đưa NVL lên line: "MÃ|PO" → lượng từng lần lấy */
  plan?: Record<string, JitPlanItem>;
  /** Số ngày cộng thêm từ ngày nhận cho Lần 2, Lần 3 ([0, n2, n3]) */
  roundDays?: number[];
  /** Kho ẩn LSX khỏi danh sách JIT */
  hidden?: boolean;
  /** Ký nhận từng lần (r1, r2, r3) — quét QR người nhận trên điện thoại */
  signs?: Record<string, JitSign>;
}

/** Ký nhận 1 lần giao: mã người nhận (QR thẻ) */
interface JitSign { receivers: string[]; at: any; by: string }

/** Kho không đưa lên line theo JIT — ẩn khỏi sắp xếp */
const HIDDEN_KHO = new Set(['NVL_SX', 'NVL_KS']);

/** Lượng 1 mã NVL đưa lên line ở từng lần lấy (q[0] = Lấy 1…). */
interface JitPlanItem {
  code: string; po: string; name: string; unit: string;
  maKho?: string;
  /** Lượng từng lần (tính từ số cuộn × Standard) */
  q: number[];
  std?: number;
  /** Tick chọn lần lấy */
  sel?: boolean[];
  /** Số cuộn từng lần */
  rolls?: number[];
  /** Kho đã giao lần đó */
  dlv?: boolean[];
}

/** Mẫu gọi hàng theo mã TP — doc jit-product-pattern/{productCode}: khoảng cách (phút) giữa các lần gọi */
interface JitPattern {
  productCode: string; gapsMin: number[]; rounds: number; fromLsx?: string; updatedAt?: any;
  /** Tỷ lệ chia mỗi mã NVL qua các lần lấy (theo mã NVL) — LSX sau cùng mã TP tự chia theo */
  planRatio?: Record<string, number[]>;
  /** Số ngày cộng thêm cho Lần 2, Lần 3 (từ ngày nhận) */
  roundDays?: number[];
  /** LSX đã lưu cách chia này (History) */
  planFromLsx?: string;
}

interface JitRow {
  woId: string;
  lsx: string;
  productCode: string;
  factory: string;
  quantity: number;
  customer: string;
  line: string;
  status: string;
  deliveryDate: Date | null;
  createdMs: number;
  /** Standard chốt lúc Ready (Work Order) */
  stdSnapshot?: Record<string, number>;
  state: JitState;
  pattern: JitPattern | null;
  nextInput: string;
  busy: boolean;
  /** Chi tiết NVL (PXK) — mở khi bấm LSX */
  open?: boolean;
  matLoading?: boolean;
  matError?: string;
  mats?: JitMat[];
  planDirty?: boolean;
  planSaving?: boolean;
}

/** 1 mã NVL trong PXK của LSX (không gồm mã R). */
interface JitMat {
  code: string; name: string; po: string; unit: string; maKho: string; need: number; exported: number;
  /** Lượng từng lần (tính từ cuộn) */
  plan: number[];
  /** Standard packing (1 cuộn) — 0 = chưa có */
  std: number;
  /** Tổng số cuộn = làm tròn lên (Cần / Standard) */
  totalRolls: number;
  sel: boolean[];
  rolls: number[];
  dlv: boolean[];
}

export const JIT_ROUNDS = 3;

/** Full trang (bỏ lề / footer layout) — dùng chung class với Lịch làm việc */
const BODY_CLASS = 'ws-fullscreen-layout';

@Component({
  selector: 'app-jit',
  templateUrl: './jit.component.html',
  styleUrls: ['./jit.component.scss']
})
export class JitComponent implements OnInit, OnDestroy {
  factorySel: 'ALL' | 'ASM1' | 'ASM3' = 'ALL';
  hideDone = true;
  /** Lọc theo Line nhận ('' = tất cả) */
  lineSel = '';
  /** Sắp xếp theo ngày nhận: tăng dần (true) / giảm dần */
  sortAsc = true;
  /** Tài khoản kho (bộ phận WH / Admin / Quản lý) — mới được ẩn LSX */
  isKho = false;
  /** Kho: hiện cả LSX đã ẩn (để bỏ ẩn) */
  showHidden = false;
  search = '';
  loading = false;
  error = '';
  rows: JitRow[] = [];
  readonly rounds = Array.from({ length: JIT_ROUNDS }, (_, i) => i);
  private patterns = new Map<string, JitPattern>();
  private userName = '';

  constructor(
    private afs: AngularFirestore,
    private afAuth: AngularFireAuth,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private nvlCatalog: NvlCatalogFullService,
    private dialog: MatDialog
  ) {}

  /** Standard packing theo mã NVL (danh mục NVL) */
  private stdByCode: Map<string, number> | null = null;
  private async ensureStd(): Promise<Map<string, number>> {
    if (this.stdByCode) return this.stdByCode;
    const m = new Map<string, number>();
    try {
      (await this.nvlCatalog.listAll()).forEach((i: any) => {
        const sp = Number(i?.standardPacking) || 0;
        if (i?.materialCode && sp > 0) m.set(String(i.materialCode).trim().toUpperCase(), sp);
      });
    } catch (e) { console.warn('[JIT] standard packing', e); }
    this.stdByCode = m;
    return m;
  }

  ngOnDestroy(): void {
    document.body.classList.remove(BODY_CLASS);
  }

  async ngOnInit(): Promise<void> {
    document.body.classList.add(BODY_CLASS);
    try {
      const u = await this.afAuth.currentUser;
      this.userName = String(u?.displayName || u?.email || '').split('@')[0].toUpperCase();
      if (u?.uid) {
        const prof = (await this.afs.firestore.collection('users').doc(u.uid).get()).data() as any;
        const dept = String(prof?.department || '').trim().toUpperCase();
        const role = String(prof?.role || '').trim();
        this.isKho = dept === 'WH' || role === 'Admin' || role === 'Quản lý';
      }
    } catch { /* ignore */ }
    await this.load();
  }

  /** ASM1 / ASM3 theo Line (WHE/WHD/WHF/WHG/WHH = ASM3), giống Work Order. */
  private jitFactoryOf(w: any): string {
    const key = String(w?.productionLine || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return /^WH[EDFGH]/.test(key) ? 'ASM3' : 'ASM1';
  }

  goBack(): void { history.length > 1 ? history.back() : void this.router.navigateByUrl('/menu'); }
  goMenu(): void { void this.router.navigateByUrl('/menu'); }

  private toDate(v: any): Date | null {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v.toDate === 'function') return v.toDate();
    if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  /** Date → giá trị ô datetime-local (giờ máy). */
  private toInput(d: Date | null): string {
    if (!d) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.cdr.markForCheck();
    try {
      const db = this.afs.firestore;
      const [woSnaps, jitSnap, patSnap] = await Promise.all([
        // ASM3 không có factory riêng: LSX ASM1 (KZ) thuộc Line WHE/WHD/WHF/WHG/WHH là ASM3
        Promise.all(['ASM1'].map((f) => db.collection('work-orders').where('factory', '==', f).get())),
        db.collection('jit-calls').get(),
        db.collection('jit-product-pattern').get()
      ]);
      const states = new Map<string, JitState>();
      jitSnap.forEach((d) => states.set(d.id, { woId: d.id, ...(d.data() as any) } as JitState));
      this.patterns.clear();
      patSnap.forEach((d) => this.patterns.set(d.id, { productCode: d.id, ...(d.data() as any) } as JitPattern));
      const cutoff = Date.now() - 60 * 24 * 3600 * 1000;
      const rows: JitRow[] = [];
      for (const snap of woSnaps) {
        snap.forEach((doc) => {
          const w = doc.data() as any;
          const lsx = String(w.productionOrder || '').trim();
          if (!lsx) return;
          const createdMs = this.toDate(w.createdDate)?.getTime() || 0;
          const status = String(w.status || '').toLowerCase();
          const done = status === 'done' || !!w.isCompleted;
          if (done && createdMs && createdMs < cutoff) return;
          const productCode = String(w.productCode || '').trim().toUpperCase();
          const st = states.get(doc.id);
          const state: JitState = {
            woId: doc.id, lsx, productCode, factory: this.jitFactoryOf(w),
            picks: Array.from({ length: JIT_ROUNDS }, (_, i) => !!st?.picks?.[i]),
            pickAt: st?.pickAt || [],
            calls: Array.isArray(st?.calls) ? st!.calls : [],
            lastCallAt: st?.lastCallAt || null,
            nextCallAt: st?.nextCallAt || null,
            plan: st?.plan || undefined,
            roundDays: Array.isArray(st?.roundDays) ? st!.roundDays : undefined,
            hidden: !!st?.hidden,
            signs: st?.signs || undefined
          };
          rows.push({
            woId: doc.id, lsx, productCode, factory: this.jitFactoryOf(w),
            quantity: Number(w.quantity) || 0, customer: String(w.customer || ''), line: String(w.productionLine || ''),
            status, deliveryDate: this.toDate(w.deliveryDate), createdMs, state, stdSnapshot: w.stdSnapshot || undefined,
            pattern: this.patterns.get(productCode) || null,
            nextInput: this.toInput(this.toDate(state.nextCallAt)), busy: false
          });
        });
      }
      rows.sort((a, b) => (a.deliveryDate?.getTime() || 9e15) - (b.deliveryDate?.getTime() || 9e15) || b.createdMs - a.createdMs);
      this.rows = rows;
    } catch (e: any) {
      this.error = 'Không tải được LSX: ' + (e?.message || e);
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  get viewRows(): JitRow[] {
    const q = this.search.trim().toUpperCase();
    const out = this.rows.filter((r) =>
      (this.factorySel === 'ALL' || r.factory.toUpperCase() === this.factorySel)
      && (!this.lineSel || r.line === this.lineSel)
      && (!this.hideDone || r.status !== 'done')
      && (!r.state.hidden || (this.isKho && this.showHidden))
      && (!q || r.lsx.toUpperCase().includes(q) || r.productCode.includes(q) || r.customer.toUpperCase().includes(q)));
    const dir = this.sortAsc ? 1 : -1;
    return out.sort((a, b) =>
      dir * ((a.deliveryDate?.getTime() ?? (this.sortAsc ? 9e15 : 0)) - (b.deliveryDate?.getTime() ?? (this.sortAsc ? 9e15 : 0)))
      || a.lsx.localeCompare(b.lsx));
  }

  /** Các Line nhận có trong danh sách (lọc). */
  get lines(): string[] {
    return [...new Set(this.rows.map((r) => r.line).filter(Boolean))].sort();
  }

  get hiddenCount(): number {
    return this.rows.filter((r) => r.state.hidden).length;
  }

  /** Kho ẩn / bỏ ẩn LSX khỏi danh sách JIT. */
  async toggleHide(r: JitRow): Promise<void> {
    if (!this.isKho) return;
    const hidden = !r.state.hidden;
    try {
      await this.stateRef(r).set({ ...this.baseFields(r), hidden, hiddenBy: this.userName, hiddenAt: new Date() }, { merge: true });
      r.state.hidden = hidden;
    } catch (e: any) {
      appAlert('Không lưu được: ' + (e?.message || e));
    } finally {
      this.cdr.markForCheck();
    }
  }

  // ===== Ngày từng lần: Lần 1 = ngày nhận LSX; Lần 2/3 = ngày nhận + số ngày nhập =====
  roundDays(r: JitRow): number[] {
    const d = r.state.roundDays || r.pattern?.roundDays || [];
    return Array.from({ length: JIT_ROUNDS }, (_, i) => (i === 0 ? 0 : Math.max(0, Math.floor(Number(d[i]) || 0))));
  }

  roundDate(r: JitRow, i: number): Date | null {
    if (!r.deliveryDate) return null;
    const d = new Date(r.deliveryDate);
    d.setDate(d.getDate() + this.roundDays(r)[i]);
    return d;
  }

  /** Nhập số ngày cho Lần 2 / Lần 3 → lưu cho LSX + làm mẫu cho mã TP. */
  async setRoundDays(r: JitRow, i: number, v: any): Promise<void> {
    const days = this.roundDays(r);
    days[i] = Math.max(0, Math.floor(Number(v) || 0));
    r.state.roundDays = days;
    try {
      await this.stateRef(r).set({ ...this.baseFields(r), roundDays: days }, { merge: true });
      if (r.productCode) {
        await this.afs.firestore.collection('jit-product-pattern').doc(r.productCode)
          .set({ productCode: r.productCode, roundDays: days, updatedAt: new Date() }, { merge: true });
        const pat: JitPattern = { ...(r.pattern || { productCode: r.productCode, gapsMin: [], rounds: 0 }), roundDays: days };
        this.patterns.set(r.productCode, pat);
        this.rows.filter((x) => x.productCode === r.productCode).forEach((x) => (x.pattern = pat));
      }
    } catch (e: any) {
      appAlert('Không lưu được số ngày: ' + (e?.message || e));
    } finally {
      this.cdr.markForCheck();
    }
  }

  statusText(s: string): string {
    return ({ waiting: 'Waiting', kitting: 'Kitting', ready: 'Ready', 'ready-iqc': 'Ready-IQC', transfer: 'Transfer', done: 'Done', delay: 'Delay', jit: 'JIT' } as any)[s] || s || '—';
  }

  /** Lần lấy kế tiếp = ô Lấy đầu tiên chưa tick (1…3). */
  nextRound(r: JitRow): number {
    const i = r.state.picks.findIndex((x) => !x);
    return i < 0 ? JIT_ROUNDS : i + 1;
  }

  lastCallText(r: JitRow): string {
    const d = this.toDate(r.state.lastCallAt);
    return d ? d.toLocaleString('vi-VN', { hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  }

  patternText(r: JitRow): string {
    const g = r.pattern?.gapsMin || [];
    if (!g.length) return '';
    return 'Mẫu: ' + g.map((m) => '+' + this.fmtGap(m)).join(' → ');
  }

  private fmtGap(min: number): string {
    if (min >= 1440 && min % 1440 === 0) return `${min / 1440}ngày`;
    if (min >= 60) return `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;
    return `${min}p`;
  }

  private stateRef(r: JitRow) {
    return this.afs.firestore.collection('jit-calls').doc(r.woId);
  }

  private baseFields(r: JitRow): Record<string, unknown> {
    return { woId: r.woId, lsx: r.lsx, productCode: r.productCode, factory: r.factory,
      quantity: r.quantity, customer: r.customer, line: r.line, updatedAt: new Date() };
  }

  async togglePick(r: JitRow, i: number): Promise<void> {
    const picks = [...r.state.picks];
    picks[i] = !picks[i];
    const pickAt = [...(r.state.pickAt || [])];
    while (pickAt.length < JIT_ROUNDS) pickAt.push(null);
    pickAt[i] = picks[i] ? new Date() : null;
    r.state.picks = picks;
    r.state.pickAt = pickAt;
    try {
      await this.stateRef(r).set({ ...this.baseFields(r), picks, pickAt }, { merge: true });
    } catch (e: any) {
      appAlert('Không lưu được: ' + (e?.message || e));
    }
  }

  /** Nút Gọi: Zalo bot nhắn nhóm Kho; lưu lịch sử gọi + mẫu gọi của mã TP; tự hẹn lần sau theo mẫu. */
  async call(r: JitRow): Promise<void> {
    if (r.busy) return;
    const round = this.nextRound(r);
    if (!confirm(`Gọi kho lấy hàng LSX ${r.lsx} (lần ${round}/${JIT_ROUNDS})?\nZalo bot sẽ nhắn nhóm Kho.`)) return;
    r.busy = true;
    try {
      const now = new Date();
      const db = this.afs.firestore;
      await db.collection('jit-call-log').add({ ...this.baseFields(r), round, by: this.userName, auto: false, at: now, items: this.roundItems(r, round) });
      const calls: JitCall[] = [...r.state.calls, { at: now, round, by: this.userName, auto: false }];
      const next = this.nextFromPattern(r, calls.length, now);
      await this.stateRef(r).set({
        ...this.baseFields(r),
        picks: r.state.picks,
        calls,
        lastCallAt: now,
        nextCallAt: next ?? (this.toDate(r.state.nextCallAt) && this.toDate(r.state.nextCallAt)!.getTime() > now.getTime() ? r.state.nextCallAt : null)
      }, { merge: true });
      r.state.calls = calls;
      r.state.lastCallAt = now;
      if (next) { r.state.nextCallAt = next; r.nextInput = this.toInput(next); }
      await this.savePattern(r, calls);
      appAlert(`✅ Đã gọi kho: ${r.lsx} — lần ${round}` + (next ? `\nTheo mẫu mã ${r.productCode}: hẹn gọi lần sau ${next.toLocaleString('vi-VN', { hour12: false })}` : ''));
    } catch (e: any) {
      appAlert('Không gọi được: ' + (e?.message || e));
    } finally {
      r.busy = false;
      this.cdr.markForCheck();
    }
  }

  /** Hẹn lần gọi kế tiếp theo mẫu của mã TP (khoảng cách thứ n). Đã có giờ hẹn tương lai thì giữ. */
  private nextFromPattern(r: JitRow, callCount: number, now: Date): Date | null {
    const cur = this.toDate(r.state.nextCallAt);
    if (cur && cur.getTime() > now.getTime()) return null;
    const gap = r.pattern?.gapsMin?.[callCount - 1];
    if (!(gap > 0) || callCount >= JIT_ROUNDS) return null;
    return new Date(now.getTime() + gap * 60000);
  }

  /** Lưu mẫu gọi hàng của mã TP từ các lần gọi của LSX này (khoảng cách giữa các lần, phút). */
  private async savePattern(r: JitRow, calls: JitCall[]): Promise<void> {
    if (!r.productCode) return;
    const times = calls.map((c) => this.toDate(c.at)?.getTime() || 0).filter(Boolean).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push(Math.max(1, Math.round((times[i] - times[i - 1]) / 60000)));
    const old = r.pattern?.gapsMin || [];
    const merged = [...gaps, ...old.slice(gaps.length)];
    const pat: JitPattern = { productCode: r.productCode, gapsMin: merged, rounds: Math.max(calls.length, r.pattern?.rounds || 0), fromLsx: r.lsx };
    await this.afs.firestore.collection('jit-product-pattern').doc(r.productCode)
      .set({ ...pat, updatedAt: new Date() }, { merge: true });
    this.patterns.set(r.productCode, pat);
    this.rows.filter((x) => x.productCode === r.productCode).forEach((x) => (x.pattern = pat));
  }

  /** Chọn ngày giờ gọi lần tiếp theo → Zalo bot tự gọi đúng giờ. Giờ hẹn cũng thành mẫu của mã TP. */
  async setNext(r: JitRow): Promise<void> {
    const v = String(r.nextInput || '').trim();
    const d = v ? new Date(v) : null;
    if (d && isNaN(d.getTime())) return;
    if (d && d.getTime() < Date.now() - 60000) {
      appAlert('Giờ hẹn đã qua — chọn giờ sau hiện tại.');
      return;
    }
    try {
      await this.stateRef(r).set({ ...this.baseFields(r), nextCallAt: d || null, nextBy: this.userName }, { merge: true });
      r.state.nextCallAt = d;
      // Mẫu: khoảng cách từ lần gọi gần nhất tới giờ hẹn
      const last = this.toDate(r.state.lastCallAt);
      if (d && last && r.productCode) {
        const idx = Math.max(0, r.state.calls.length - 1);
        const gapsMin = [...(r.pattern?.gapsMin || [])];
        gapsMin[idx] = Math.max(1, Math.round((d.getTime() - last.getTime()) / 60000));
        for (let i = 0; i < gapsMin.length; i++) if (!(gapsMin[i] > 0)) gapsMin[i] = gapsMin[idx];
        const pat: JitPattern = { productCode: r.productCode, gapsMin, rounds: Math.max(r.pattern?.rounds || 0, idx + 2), fromLsx: r.lsx };
        await this.afs.firestore.collection('jit-product-pattern').doc(r.productCode).set({ ...pat, updatedAt: new Date() }, { merge: true });
        this.patterns.set(r.productCode, pat);
        this.rows.filter((x) => x.productCode === r.productCode).forEach((x) => (x.pattern = pat));
      }
    } catch (e: any) {
      appAlert('Không lưu được giờ hẹn: ' + (e?.message || e));
    } finally {
      this.cdr.markForCheck();
    }
  }

  clearNext(r: JitRow): void {
    r.nextInput = '';
    void this.setNext(r);
  }

  trackRow(_: number, r: JitRow): string { return r.woId; }

  /** LSX đang mở (cả trang chuyển sang LSX này). */
  selected: JitRow | null = null;

  openLsx(r: JitRow): void {
    this.selected = r;
    void this.toggleMats(r, true);
  }

  closeLsx(): void {
    if (this.selected?.planDirty && !confirm('Sắp xếp chưa lưu. Vẫn quay lại danh sách?')) return;
    this.selected = null;
  }

  /** Tải NVL theo PXK (bỏ mã R) + lượng đã xuất của LSX. */
  async toggleMats(r: JitRow, forceOpen = false): Promise<void> {
    r.open = forceOpen ? true : !r.open;
    if (!r.open || r.mats || r.matLoading) return;
    r.matLoading = true;
    r.matError = '';
    this.cdr.markForCheck();
    try {
      const db = this.afs.firestore;
      const variants = [...new Set([r.lsx, r.lsx.toUpperCase(), r.lsx.replace(/\s+/g, '').toUpperCase()])];
      const [pxkSnap, outSnap, stdMap] = await Promise.all([
        db.collection('pxk-import-data').where('lsx', 'in', variants).get(),
        db.collection('outbound-materials').where('productionOrder', 'in', variants).get(),
        this.ensureStd()
      ]);
      const poKey = (p: unknown) => String(p ?? '').replace(/\s+/g, '').toUpperCase();
      const exported = new Map<string, number>();
      outSnap.forEach((doc) => {
        const o = doc.data() as any;
        const k = `${String(o.materialCode || '').trim().toUpperCase()}|${poKey(o.poNumber ?? o.po)}`;
        exported.set(k, (exported.get(k) || 0) + (Number(o.exportQuantity ?? o.quantity) || 0));
      });
      const byKey = new Map<string, JitMat>();
      pxkSnap.forEach((doc) => {
        for (const l of ((doc.data() as any)?.lines || []) as any[]) {
          const code = String(l?.materialCode || '').trim().toUpperCase();
          if (!code || code.startsWith('R')) continue;
          if (HIDDEN_KHO.has(String(l?.maKho || '').trim().toUpperCase())) continue; // ẩn kho NVL_SX, NVL_KS
          const po = String(l?.po ?? l?.poNumber ?? '').trim();
          const k = `${code}|${poKey(po)}`;
          const cur = byKey.get(k);
          const q = Number(String(l?.quantity ?? 0).replace(/,/g, '')) || 0;
          if (cur) { cur.need += q; continue; }
          byKey.set(k, {
            code, name: String(l?.tenVatTu || '').trim(), po, unit: String(l?.unit || '').trim(),
            maKho: String(l?.maKho || '').trim(), need: q, exported: exported.get(k) || 0, plan: [],
            std: (r.stdSnapshot?.[code] || 0) > 0 ? r.stdSnapshot![code] : (stdMap.get(code) || 0), totalRolls: 0, sel: [], rolls: [], dlv: []
          });
        }
      });
      const r4 = (n: number) => Math.round(n * 10000) / 10000;
      r.mats = [...byKey.values()]
        .map((m) => ({ ...m, need: r4(m.need), exported: r4(m.exported) }))
        .sort((a, b) => a.code.localeCompare(b.code) || a.po.localeCompare(b.po));
      // Sắp xếp (theo cuộn): đã lưu của LSX → mặc định tất cả Lần 1 (mẫu mã TP: nút Apply ở cột History)
      for (const m of r.mats) {
        m.totalRolls = m.std > 0 ? Math.max(1, Math.ceil(m.need / m.std - 1e-9)) : 1;
        const saved = r.state.plan?.[this.matKey(m)];
        m.dlv = this.fitBool(saved?.dlv);
        if (saved?.rolls?.length) {
          m.rolls = this.fitInt(saved.rolls);
          m.sel = saved.sel?.length ? this.fitBool(saved.sel) : m.rolls.map((x) => x > 0);
        } else if (saved?.q?.length) {
          m.rolls = this.fitInt(saved.q.map((q) => (q > 0 ? (m.std > 0 ? Math.ceil(q / m.std - 1e-9) : 1) : 0)));
          m.sel = m.rolls.map((x) => x > 0);
        } else {
          m.rolls = this.fitInt([m.totalRolls]);
          m.sel = m.rolls.map((x) => x > 0);
        }
        this.recalc(m);
      }
      r.planDirty = false;
      if (!pxkSnap.size) r.matError = 'LSX chưa import PXK.';
    } catch (e: any) {
      r.matError = 'Không tải được NVL: ' + (e?.message || e);
    } finally {
      r.matLoading = false;
      this.cdr.markForCheck();
    }
  }

  private matKey(m: { code: string; po: string }): string {
    return `${m.code}|${String(m.po || '').replace(/\s+/g, '').toUpperCase()}`;
  }

  private fitInt(a: number[] | undefined): number[] {
    return Array.from({ length: JIT_ROUNDS }, (_, i) => Math.max(0, Math.floor(Number(a?.[i]) || 0)));
  }

  private fitBool(a: boolean[] | undefined): boolean[] {
    return Array.from({ length: JIT_ROUNDS }, (_, i) => !!a?.[i]);
  }

  /** Chia tổng cuộn theo tỷ lệ; phần dư dồn về lần cuối có tỷ lệ > 0. */
  private splitRolls(total: number, ratio: number[]): number[] {
    const sum = ratio.slice(0, JIT_ROUNDS).reduce((a, x) => a + (Number(x) || 0), 0);
    if (!(sum > 0)) return this.fitInt([total]);
    const out = this.fitInt(ratio.map((x) => Math.round(total * (Number(x) || 0) / sum)));
    const last = out.map((x, i) => ((Number(ratio[i]) || 0) > 0 ? i : -1)).filter((i) => i >= 0).pop() ?? 0;
    out[last] = Math.max(0, out[last] + total - out.reduce((a, x) => a + x, 0));
    return out;
  }

  /** Lượng từng lần từ số cuộn: lần trước lấy trước, mỗi cuộn = Standard, không vượt lượng cần. */
  private recalc(m: JitMat): void {
    let left = m.need;
    m.plan = m.rolls.map((n, i) => {
      if (!m.sel[i] || !(n > 0) || left <= 0) return 0;
      const q = m.std > 0 ? Math.min(n * m.std, left) : left;
      left = Math.round((left - q) * 10000) / 10000;
      return Math.round(q * 10000) / 10000;
    });
  }

  rollSum(m: JitMat): number {
    return m.rolls.reduce((a, n, i) => a + (m.sel[i] ? n : 0), 0);
  }

  planOk(m: JitMat): boolean {
    return this.rollSum(m) === m.totalRolls;
  }

  roundTotalCount(r: JitRow, i: number): number {
    return (r.mats || []).filter((m) => m.sel[i] && m.rolls[i] > 0).length;
  }

  roundRolls(r: JitRow, i: number): number {
    return (r.mats || []).reduce((a, m) => a + (m.sel[i] ? m.rolls[i] : 0), 0);
  }

  /** Tick chọn lần i: bật → điền số cuộn còn lại; tắt → 0 cuộn. */
  toggleSel(r: JitRow, m: JitMat, i: number): void {
    if (i > 0 && !m.sel[i] && !this.canSplit(m)) {
      appAlert(`Mã ${m.code} chưa có Mã kho — không chia lượt nhận được (chỉ Lần 1).`);
      return;
    }
    m.sel[i] = !m.sel[i];
    if (m.sel[i] && !(m.rolls[i] > 0)) {
      const others = m.rolls.reduce((a, n, j) => a + (j !== i && m.sel[j] ? n : 0), 0);
      m.rolls[i] = Math.max(1, m.totalRolls - others);
    }
    if (!m.sel[i]) m.rolls[i] = 0;
    this.recalc(m);
    r.planDirty = true;
  }

  onRollsEdit(r: JitRow, m: JitMat, i: number, v: any): void {
    if (i > 0 && !this.canSplit(m)) return;
    m.rolls[i] = Math.max(0, Math.floor(Number(v) || 0));
    m.sel[i] = m.rolls[i] > 0;
    this.recalc(m);
    r.planDirty = true;
  }

  /** Chỉ chia nhiều lần cho mã có tổng cuộn > 5; mã ít cuộn để hết Lần 1. */
  static readonly SPLIT_MIN_ROLLS = 5;

  /** Nút nhanh: tất cả Lần 1, hoặc chia đều 2 / 3 lần (chỉ mã > 5 cuộn). */
  quickPlan(r: JitRow, mode: 'one' | 2 | 3): void {
    for (const m of r.mats || []) {
      const split = mode !== 'one' && m.totalRolls > JitComponent.SPLIT_MIN_ROLLS && this.canSplit(m);
      m.rolls = split ? this.splitRolls(m.totalRolls, Array.from({ length: mode as number }, () => 1)) : this.fitInt([m.totalRolls]);
      m.sel = m.rolls.map((x) => x > 0);
      this.recalc(m);
    }
    r.planDirty = true;
  }

  /**
   * Đồng bộ trạng thái Work Order theo JIT:
   * - Có mã chia sang Lần 2/3 → jitActive; LSX đang Done → JIT.
   * - Kho tick Đã giao hết các lần đã chọn → jitDelivered; LSX đang JIT → tự Done.
   */
  private async syncWoJit(r: JitRow): Promise<void> {
    const plan = this.visiblePlan(r).map((x) => x.p);
    const used = (p: JitPlanItem, k: number) => this.usedIn(p, k);
    const active = this.planActive(r);
    const delivered = active && plan.every((p) => this.rounds.every((k) => !used(p, k) || !!p.dlv?.[k]));
    const patch: Record<string, unknown> = { jitActive: active, jitDelivered: delivered, lastUpdated: new Date() };
    let msg = '';
    if (active && !delivered && r.status === 'done') { patch['status'] = 'jit'; msg = `LSX ${r.lsx} chuyển sang JIT (chưa giao hết).`; }
    if ((!active || delivered) && r.status === 'jit') {
      patch['status'] = 'done';
      patch['doneAt'] = new Date();
      msg = delivered ? `✅ LSX ${r.lsx} đã giao hết các lần JIT → Done.` : `LSX ${r.lsx} không còn chia nhiều lần → Done.`;
    }
    try {
      await this.afs.firestore.collection('work-orders').doc(r.woId).update(patch);
      if (patch['status']) r.status = String(patch['status']);
      if (msg) appAlert(msg);
    } catch (e) {
      console.warn('[JIT] sync Work Order', e);
    }
  }

  /** Kho bấm Đã giao lần i của 1 mã — lưu ngay. */
  async toggleDlv(r: JitRow, m: JitMat, i: number): Promise<void> {
    await this.setDlv(r, this.matKey(m), i, !m.dlv[i]);
  }

  private async setDlv(r: JitRow, key: string, i: number, val: boolean): Promise<boolean> {
    const p = r.state.plan?.[key];
    if (!p) {
      appAlert('Bấm Lưu sắp xếp trước khi đánh dấu Đã giao.');
      this.cdr.markForCheck();
      return false;
    }
    const dlv = this.fitBool(p.dlv);
    dlv[i] = val;
    try {
      await this.stateRef(r).update(new firebase.firestore.FieldPath('plan', key, 'dlv'), dlv);
      p.dlv = dlv;
      const m = r.mats?.find((x) => this.matKey(x) === key);
      if (m) m.dlv = [...dlv];
      await this.syncWoJit(r);
      return true;
    } catch (e: any) {
      appAlert('Không lưu được Đã giao: ' + (e?.message || e));
      return false;
    } finally {
      this.cdr.markForCheck();
    }
  }

  // ===== Mã kho: chưa có Mã kho → không chia lượt nhận (chỉ Lần 1) =====
  canSplit(m: JitMat): boolean { return !!String(m.maKho || '').trim(); }
  lsxHasKho(r: JitRow): boolean { return (r.mats || []).some((m) => this.canSplit(m)); }
  noKhoCount(r: JitRow): number { return (r.mats || []).filter((m) => !this.canSplit(m)).length; }

  /** Mã trong sắp xếp đã lưu (bỏ kho ẩn) */
  private visiblePlan(r: JitRow): Array<{ key: string; p: JitPlanItem }> {
    return Object.entries(r.state.plan || {})
      .filter(([, p]) => !HIDDEN_KHO.has(String(p?.maKho || '').trim().toUpperCase()))
      .map(([key, p]) => ({ key, p }))
      .sort((a, b) => a.p.code.localeCompare(b.p.code) || String(a.p.po).localeCompare(String(b.p.po)));
  }

  private usedIn(p: JitPlanItem, k: number): boolean {
    return !!p.sel?.[k] && (Number(p.rolls?.[k]) || 0) > 0;
  }

  /** LSX đang chia nhiều lần giao (có mã ở Lần 2/3) */
  planActive(r: JitRow): boolean {
    return this.visiblePlan(r).some(({ p }) => this.rounds.some((k) => k > 0 && this.usedIn(p, k)));
  }

  // ===== History: mã TP từng chia JIT → Apply / Unapply cho LSX sau =====
  private splitCodes(r: JitRow): number[][] {
    return Object.values(r.pattern?.planRatio || {}).filter((a) => (Number(a?.[1]) || 0) > 0 || (Number(a?.[2]) || 0) > 0);
  }

  hasHistory(r: JitRow): boolean { return this.splitCodes(r).length > 0; }

  historyText(r: JitRow): string {
    const codes = this.splitCodes(r);
    if (!codes.length) return '';
    const n = codes.some((a) => (Number(a?.[2]) || 0) > 0) ? 3 : 2;
    const d = r.pattern?.roundDays || [];
    const days = [1, 2].slice(0, n - 1).map((i) => `L${i + 1} +${Number(d[i]) || 0}ng`).join(', ');
    return `${codes.length} mã chia ${n} lần (${days})` + (r.pattern?.planFromLsx ? ` · từ ${r.pattern.planFromLsx}` : '');
  }

  /** Apply cách chia JIT đã lưu của mã TP cho LSX này. */
  async applyHistory(r: JitRow): Promise<void> {
    if (r.busy || !this.hasHistory(r)) return;
    r.busy = true;
    this.cdr.markForCheck();
    try {
      if (!r.mats) await this.toggleMats(r, true);
      if (!r.mats?.length) { appAlert(r.matError || `LSX ${r.lsx} chưa có mã NVL để chia.`); return; }
      if (!this.lsxHasKho(r)) { appAlert(`LSX ${r.lsx} chưa có Mã kho — chưa chia lượt nhận được.`); return; }
      const ratio = r.pattern?.planRatio || {};
      let n = 0;
      for (const m of r.mats) {
        const rt = ratio[m.code];
        const split = !!rt?.length && this.canSplit(m) && rt.slice(1).some((x) => (Number(x) || 0) > 0);
        m.rolls = split ? this.splitRolls(m.totalRolls, rt) : this.fitInt([m.totalRolls]);
        m.sel = m.rolls.map((x) => x > 0);
        if (split) n++;
        this.recalc(m);
      }
      if (!r.state.roundDays && r.pattern?.roundDays) {
        const days = this.roundDays(r);
        await this.stateRef(r).set({ ...this.baseFields(r), roundDays: days }, { merge: true });
        r.state.roundDays = days;
      }
      await this.savePlan(r, { fromHistory: true });
      if (!r.planDirty) appAlert(`✅ Đã Apply cách JIT của mã ${r.productCode} cho ${r.lsx}: ${n} mã chia nhiều lần.`);
    } finally {
      r.busy = false;
      this.cdr.markForCheck();
    }
  }

  /** Unapply: bỏ chia JIT của LSX — tất cả về Lần 1. */
  async unapplyHistory(r: JitRow): Promise<void> {
    if (r.busy || !r.state.plan) return;
    if (this.visiblePlan(r).some(({ p }) => (p.dlv || []).some(Boolean))) {
      appAlert('Kho đã tick Đã giao cho LSX này — không Unapply được.');
      return;
    }
    if (!confirm(`Unapply: bỏ chia JIT của ${r.lsx}? Tất cả mã về Lần 1.`)) return;
    r.busy = true;
    try {
      await this.stateRef(r).update({ plan: firebase.firestore.FieldValue.delete(), updatedAt: new Date() });
      r.state.plan = undefined;
      r.mats = undefined;
      r.open = false;
      r.planDirty = false;
      await this.syncWoJit(r);
    } catch (e: any) {
      appAlert('Không Unapply được: ' + (e?.message || e));
    } finally {
      r.busy = false;
      this.cdr.markForCheck();
    }
  }

  // ===== Giao diện điện thoại: kho tick Đã giao + ký nhận bằng QR người nhận =====
  mobile = typeof window !== 'undefined' && window.innerWidth < 768;
  mSel: JitRow | null = null;
  mRound = 0;
  signIds: string[] = [];
  signInput = '';
  signSaving = false;

  @HostListener('window:resize')
  onResize(): void { this.mobile = window.innerWidth < 768; }

  get mobileRows(): JitRow[] {
    const q = this.search.trim().toUpperCase();
    return this.rows
      .filter((r) => !r.state.hidden && this.visiblePlan(r).length
        && (!this.hideDone || r.status !== 'done')
        && (!q || r.lsx.toUpperCase().includes(q) || r.productCode.includes(q)))
      .sort((a, b) => (a.deliveryDate?.getTime() ?? 9e15) - (b.deliveryDate?.getTime() ?? 9e15) || a.lsx.localeCompare(b.lsx));
  }

  mItems(r: JitRow, k: number): Array<{ key: string; p: JitPlanItem }> {
    return this.visiblePlan(r).filter(({ p }) => this.usedIn(p, k));
  }

  mRoundsOf(r: JitRow): number[] { return this.rounds.filter((k) => this.mItems(r, k).length > 0); }
  mDoneCount(r: JitRow, k: number): number { return this.mItems(r, k).filter(({ p }) => !!p.dlv?.[k]).length; }
  mRoundDone(r: JitRow, k: number): boolean { const n = this.mItems(r, k).length; return n > 0 && this.mDoneCount(r, k) === n; }

  mOpen(r: JitRow): void {
    this.mSel = r;
    const rs = this.mRoundsOf(r);
    this.mRound = rs.find((k) => !this.mRoundDone(r, k)) ?? rs[0] ?? 0;
    this.signIds = [];
    this.signInput = '';
  }

  mPickRound(k: number): void { this.mRound = k; this.signIds = []; }
  mBack(): void { if (this.mSel) this.mSel = null; else this.goBack(); }

  async mToggle(r: JitRow, key: string, k: number): Promise<void> {
    const p = r.state.plan?.[key];
    if (p) await this.setDlv(r, key, k, !p.dlv?.[k]);
  }

  signOf(r: JitRow, k: number): JitSign | null { return r.state.signs?.['r' + (k + 1)] || null; }

  fmtTime(v: any): string {
    const d = this.toDate(v);
    return d ? d.toLocaleString('vi-VN', { hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  }

  /** Mã người nhận từ QR thẻ (ASP + 4 số), không có thì giữ nguyên chuỗi. */
  private addSigner(raw: string): void {
    const t = String(raw || '').trim().toUpperCase();
    if (!t) return;
    const id = t.match(/ASP\d{4}/)?.[0] || t.slice(0, 40);
    if (!this.signIds.includes(id)) this.signIds = [...this.signIds, id];
    this.cdr.markForCheck();
  }

  mAddInput(): void { this.addSigner(this.signInput); this.signInput = ''; }
  removeSigner(i: number): void { this.signIds = this.signIds.filter((_, j) => j !== i); }

  mScan(): void {
    const ref = this.dialog.open(QRScannerModalComponent, {
      data: { title: 'Quét QR người nhận', message: 'Hướng camera vào mã QR thẻ người nhận' },
      panelClass: 'qr-scanner-dialog-panel', maxWidth: '95vw', width: '420px'
    });
    ref.afterClosed().subscribe((res: any) => { if (res?.success && res?.text) this.addSigner(String(res.text)); });
  }

  /** Ký nhận lần k: lưu người nhận + đánh dấu Đã giao tất cả mã của lần đó. */
  async mSaveSign(r: JitRow, k: number): Promise<void> {
    if (this.signSaving) return;
    if (!this.signIds.length) { appAlert('Quét QR người nhận trước.'); return; }
    const items = this.mItems(r, k);
    if (!items.length) return;
    if (!confirm(`Ký nhận Lần ${k + 1} — ${items.length} mã
Người nhận: ${this.signIds.join(', ')}
Tất cả mã của lần này sẽ đánh dấu Đã giao.`)) return;
    this.signSaving = true;
    try {
      const now = new Date();
      const sign: JitSign = { receivers: [...this.signIds], at: now, by: this.userName };
      const more: any[] = [];
      const dlvs = items.map(({ key, p }) => {
        const d = this.fitBool(p.dlv);
        d[k] = true;
        more.push(new firebase.firestore.FieldPath('plan', key, 'dlv'), d);
        return d;
      });
      await this.stateRef(r).update(new firebase.firestore.FieldPath('signs', 'r' + (k + 1)), sign, ...more);
      items.forEach(({ key, p }, j) => {
        p.dlv = dlvs[j];
        const m = r.mats?.find((x) => this.matKey(x) === key);
        if (m) m.dlv = [...dlvs[j]];
      });
      r.state.signs = { ...(r.state.signs || {}), ['r' + (k + 1)]: sign };
      void this.afs.firestore.collection('jit-sign-log').add({
        ...this.baseFields(r), round: k + 1, receivers: sign.receivers, at: now, by: this.userName,
        items: items.map(({ p }) => ({ code: p.code, po: p.po, rolls: Number(p.rolls?.[k]) || 0, qty: Number(p.q?.[k]) || 0 }))
      }).catch((e) => console.warn('[JIT] sign log', e));
      this.signIds = [];
      await this.syncWoJit(r);
      const next = this.mRoundsOf(r).find((x) => !this.mRoundDone(r, x));
      if (next != null) this.mRound = next;
    } catch (e: any) {
      appAlert('Không lưu được ký nhận: ' + (e?.message || e));
    } finally {
      this.signSaving = false;
      this.cdr.markForCheck();
    }
  }

  /** Lưu sắp xếp cho LSX + tỷ lệ cuộn theo mã TP (LSX sau cùng mã TP tự chia theo). */
  async savePlan(r: JitRow, opts: { fromHistory?: boolean } = {}): Promise<void> {
    if (!r.mats?.length || r.planSaving) return;
    const bad = r.mats.filter((m) => !this.planOk(m));
    if (bad.length && !confirm(`${bad.length} mã có tổng cuộn các lần khác tổng cuộn cần (vd ${bad[0].code}: ${this.rollSum(bad[0])} / ${bad[0].totalRolls} cuộn). Vẫn lưu?`)) return;
    r.planSaving = true;
    try {
      const plan: Record<string, JitPlanItem> = {};
      const ratio: Record<string, number[]> = {};
      for (const m of r.mats) {
        this.recalc(m);
        const rolls = m.rolls.map((n, i) => (m.sel[i] ? n : 0));
        plan[this.matKey(m)] = {
          code: m.code, po: m.po, name: m.name, unit: m.unit, std: m.std, maKho: m.maKho,
          q: [...m.plan], sel: [...m.sel], rolls, dlv: [...m.dlv]
        };
        const acc = ratio[m.code] || Array(JIT_ROUNDS).fill(0);
        rolls.forEach((n, i) => (acc[i] += n));
        ratio[m.code] = acc;
      }
      for (const k of Object.keys(ratio)) {
        const t = ratio[k].reduce((a, b) => a + b, 0);
        ratio[k] = ratio[k].map((x) => (t > 0 ? Math.round((x / t) * 10000) / 10000 : 0));
      }
      await this.stateRef(r).set({ ...this.baseFields(r), plan }, { merge: true });
      await this.stateRef(r).update({ plan }); // ghi đè cả map (bỏ mã cũ)
      r.state.plan = plan;
      await this.syncWoJit(r);
      // Lưu History cho mã TP chỉ khi LSX có chia nhiều lần (không ghi đè bằng sắp xếp toàn Lần 1)
      if (r.productCode && !opts.fromHistory && this.planActive(r)) {
        const ref = this.afs.firestore.collection('jit-product-pattern').doc(r.productCode);
        await ref.set({ productCode: r.productCode, planRatio: ratio, planFromLsx: r.lsx, updatedAt: new Date() }, { merge: true });
        const pat: JitPattern = { ...(r.pattern || { productCode: r.productCode, gapsMin: [], rounds: 0 }), planRatio: { ...(r.pattern?.planRatio || {}), ...ratio }, planFromLsx: r.lsx };
        this.patterns.set(r.productCode, pat);
        this.rows.filter((x) => x.productCode === r.productCode).forEach((x) => (x.pattern = pat));
      }
      r.planDirty = false;
    } catch (e: any) {
      appAlert('Không lưu được sắp xếp: ' + (e?.message || e));
    } finally {
      r.planSaving = false;
      this.cdr.markForCheck();
    }
  }

  /** Mã + số cuộn + lượng đưa lên line ở lần lấy `round` (gửi kèm tin Zalo khi gọi). */
  private roundItems(r: JitRow, round: number): Array<{ code: string; po: string; qty: number; unit: string; rolls: number }> {
    const i = round - 1;
    const src = r.mats?.length
      ? r.mats.map((m) => ({ code: m.code, po: m.po, unit: m.unit, q: m.plan, rolls: m.rolls.map((n, j) => (m.sel[j] ? n : 0)) }))
      : Object.values(r.state.plan || {}).map((p) => ({ code: p.code, po: p.po, unit: p.unit, q: p.q, rolls: p.rolls || [] }));
    return src
      .filter((x) => (Number(x.q?.[i]) || 0) > 0)
      .map((x) => ({ code: x.code, po: x.po, qty: Math.round((Number(x.q[i]) || 0) * 10000) / 10000, unit: x.unit, rolls: Number(x.rolls?.[i]) || 0 }));
  }

  matState(m: JitMat): 'du' | 'thieu' | 'chua' {
    if (m.exported <= 0) return 'chua';
    return m.exported + 0.005 >= m.need ? 'du' : 'thieu';
  }
}
