import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import { firstValueFrom } from 'rxjs';

/** Một mã vật tư trong danh sách nghi ngờ (đã gộp mã trùng). */
export interface SxxkSuspectInfo {
  /** 'auto' = lọc từ bảng kê xuất SXXK; 'manual' = nhập tay */
  source?: 'auto' | 'manual';
  /** Người nhập tay (chỉ với source 'manual') */
  by?: string;
  /** Số dòng xuất bổ sung của mã */
  n: number;
  /** Ngày xuất bổ sung gần nhất (yyyy-mm-dd) */
  last: string;
  /** Số phiếu xuất gần nhất */
  voucher: string;
  /** Diễn giải của lần xuất bổ sung gần nhất (rút gọn) */
  reason: string;
}

interface SuspectDoc {
  details?: Record<string, SxxkSuspectInfo>;
  builtAt?: firebase.firestore.Timestamp;
  fromDate?: string;
}

/**
 * Danh sách vật tư nghi ngờ lấy từ SXXK (cùng Firestore airspeed-warehouse):
 * bảng kê xuất có cột "Diễn giải" chứa "bổ sung" → mã vật tư (bỏ trùng) → kiểm 100% khi nhập hàng.
 *
 * Danh sách lưu ở sxxk-suspect-materials/current, 2 tuần tính lại một lần: khi đọc thấy bản lưu đã
 * quá 14 ngày (hoặc chưa có) thì đọc bộ dữ liệu SXXK hiện hành (sxxk_meta/current →
 * sxxk_datasets/{id}/chunks, JSON nén gzip) để dựng lại rồi lưu.
 */
@Injectable({ providedIn: 'root' })
export class SxxkSuspectService {
  static readonly COLLECTION = 'sxxk-suspect-materials';
  static readonly DOC = 'current';
  /** Lấy các lần xuất bổ sung từ ngày này */
  static readonly FROM_DATE = '2026-01-01';
  static readonly REFRESH_MS = 14 * 24 * 60 * 60 * 1000;
  /** Ngày gốc của số ngày trong dữ liệu SXXK (SXXK.EPOCH) */
  private static readonly SXXK_EPOCH = Date.UTC(2026, 0, 1);

  private cache: Map<string, SxxkSuspectInfo> | null = null;
  private loading: Promise<Map<string, SxxkSuspectInfo>> | null = null;

  constructor(private firestore: AngularFirestore) {}

  /** Mã 7 ký tự (B008016…) để so khớp; mã hàng Inbound có thể kèm hậu tố. */
  static normalizeCode(code: string | null | undefined): string {
    const m = /^([A-Z]\d{6})/.exec(String(code || '').trim().toUpperCase());
    return m ? m[1] : '';
  }

  static readonly MANUAL_DOC = 'manual';

  /** Mã nhập tay — lưu riêng ở sxxk-suspect-materials/manual, lần tính lại 2 tuần không đụng tới. */
  private manual = new Map<string, SxxkSuspectInfo>();

  /**
   * Danh sách nghi ngờ = mã lọc từ SXXK (tự dựng lại nếu bản lưu quá 14 ngày) + mã nhập tay.
   * Lỗi → danh sách rỗng, không chặn công việc.
   */
  load(): Promise<Map<string, SxxkSuspectInfo>> {
    if (this.cache) return Promise.resolve(this.cache);
    if (!this.loading) {
      this.loading = Promise.all([this.loadOrRebuild(), this.loadManual()])
        .then(([auto, manual]) => {
          this.manual = manual;
          const merged = new Map<string, SxxkSuspectInfo>();
          auto.forEach((v, k) => merged.set(k, { ...v, source: 'auto' }));
          manual.forEach((v, k) => { if (!merged.has(k)) merged.set(k, v); });
          return merged;
        })
        .then(map => (this.cache = map))
        .catch(err => {
          console.warn('[SxxkSuspect] load failed', err);
          return new Map<string, SxxkSuspectInfo>();
        })
        .finally(() => (this.loading = null));
    }
    return this.loading;
  }

  /** Tra cứu đồng bộ sau khi đã load(). */
  get(code: string | null | undefined): SxxkSuspectInfo | null {
    const key = SxxkSuspectService.normalizeCode(code);
    return (key && this.cache?.get(key)) || null;
  }

  /** Toàn bộ danh sách (đã load) để hiển thị: nhập tay trước, rồi theo mã. */
  list(): Array<{ code: string } & SxxkSuspectInfo> {
    return [...(this.cache || new Map()).entries()]
      .map(([code, v]) => ({ code, ...v }))
      .sort((a, b) => (a.source === b.source ? a.code.localeCompare(b.code) : a.source === 'manual' ? -1 : 1));
  }

  /** Thêm mã nhập tay. Trả về lỗi (chuỗi) nếu mã không hợp lệ. */
  async addManual(code: string, note: string, by: string): Promise<string> {
    const key = SxxkSuspectService.normalizeCode(code);
    if (!key) return 'Mã vật tư phải có dạng 1 chữ + 6 số, ví dụ B018329.';
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const info: SxxkSuspectInfo = {
      source: 'manual', by: String(by || '').trim(), n: 0, last: iso, voucher: '',
      reason: String(note || '').trim().slice(0, 200) || 'Nhập tay'
    };
    await this.firestore.collection(SxxkSuspectService.COLLECTION).doc(SxxkSuspectService.MANUAL_DOC)
      .set({ codes: { [key]: info }, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    this.manual.set(key, info);
    if (this.cache && !(this.cache.get(key)?.source === 'auto')) this.cache.set(key, info);
    return '';
  }

  /** Xóa mã nhập tay (mã lọc tự động từ SXXK không xóa được ở đây). */
  async removeManual(code: string): Promise<void> {
    const key = SxxkSuspectService.normalizeCode(code);
    if (!key || !this.manual.has(key)) return;
    await this.firestore.collection(SxxkSuspectService.COLLECTION).doc(SxxkSuspectService.MANUAL_DOC)
      .update({ [`codes.${key}`]: firebase.firestore.FieldValue.delete(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    this.manual.delete(key);
    if (this.cache?.get(key)?.source === 'manual') this.cache.delete(key);
  }

  private async loadManual(): Promise<Map<string, SxxkSuspectInfo>> {
    try {
      const snap = await firstValueFrom(
        this.firestore.collection(SxxkSuspectService.COLLECTION).doc(SxxkSuspectService.MANUAL_DOC).get()
      );
      const codes = ((snap.exists ? snap.data() : null) as { codes?: Record<string, SxxkSuspectInfo> } | null)?.codes || {};
      return new Map(Object.entries(codes).map(([k, v]) => [k, { ...v, source: 'manual' as const }]));
    } catch (e) {
      console.warn('[SxxkSuspect] manual list failed', e);
      return new Map();
    }
  }

  private async loadOrRebuild(): Promise<Map<string, SxxkSuspectInfo>> {
    const ref = this.firestore.collection(SxxkSuspectService.COLLECTION).doc(SxxkSuspectService.DOC);
    const snap = await firstValueFrom(ref.get());
    const saved = (snap.exists ? snap.data() : null) as SuspectDoc | null;
    const builtMs = saved?.builtAt?.toMillis?.() || 0;
    const fresh = saved?.details
      && saved.fromDate === SxxkSuspectService.FROM_DATE
      && Date.now() - builtMs < SxxkSuspectService.REFRESH_MS;
    if (fresh) return new Map(Object.entries(saved!.details!));

    try {
      const rebuilt = await this.buildFromSxxk();
      await ref.set({
        details: Object.fromEntries(rebuilt.details),
        count: rebuilt.details.size,
        rows: rebuilt.rows,
        datasetId: rebuilt.datasetId,
        fromDate: SxxkSuspectService.FROM_DATE,
        builtAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return rebuilt.details;
    } catch (e) {
      // Không dựng lại được (mạng / trình duyệt cũ) → dùng bản cũ nếu có
      console.warn('[SxxkSuspect] rebuild failed, using saved list', e);
      return new Map(Object.entries(saved?.details || {}));
    }
  }

  /** Đọc bộ dữ liệu SXXK hiện hành và lọc bảng kê xuất có "bổ sung" trong Diễn giải. */
  private async buildFromSxxk(): Promise<{ details: Map<string, SxxkSuspectInfo>; rows: number; datasetId: string }> {
    const cur = await firstValueFrom(this.firestore.collection('sxxk_meta').doc('current').get());
    const datasetId = String((cur.data() as { datasetId?: string } | undefined)?.datasetId || '');
    if (!datasetId) throw new Error('SXXK chưa có dữ liệu');
    const chunksSnap = await firstValueFrom(
      this.firestore.collection('sxxk_datasets').doc(datasetId).collection('chunks', ref => ref.orderBy('i')).get()
    );
    const arrays = chunksSnap.docs.map(d => (d.data() as { data: firebase.firestore.Blob }).data.toUint8Array());
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) {
      bytes.set(a, offset);
      offset += a.length;
    }
    const Decompress = (window as any).DecompressionStream;
    if (!Decompress) throw new Error('Trình duyệt không hỗ trợ giải nén (DecompressionStream)');
    const stream = (new Blob([bytes]).stream() as any).pipeThrough(new Decompress('gzip'));
    const text = await new Response(stream).text();
    const model = JSON.parse(text) as SxxkModel;
    return { ...SxxkSuspectService.suspectsFromModel(model), datasetId };
  }

  /** Lõi lọc (thuần, không gọi mạng). Mã trùng gộp một; giữ lần xuất bổ sung gần nhất. */
  static suspectsFromModel(model: SxxkModel): { details: Map<string, SxxkSuspectInfo>; rows: number } {
    const M = model.M;
    const fromDay = Math.round((Date.parse(SxxkSuspectService.FROM_DATE + 'T00:00:00Z') - SxxkSuspectService.SXXK_EPOCH) / 86400000);
    const details = new Map<string, SxxkSuspectInfo & { day: number }>();
    let rows = 0;
    for (let j = 0; j < M.s.length; j++) {
      const out = M.c[j] >= 10 && M.c[j] < 20; // PX, MT (xuất)
      if (!out) continue;
      const day = M.d[j];
      if (day == null || day < fromDay) continue;
      const hdr = model.hdrs?.[M.f[j]]?.X || [];
      const k = hdr.indexOf('Diễn giải');
      const note = k >= 0 && M.r[j] ? String(M.r[j]![k] ?? '').trim() : '';
      if (!/b[ổo]\s*sung/i.test(note)) continue;
      const code = SxxkSuspectService.normalizeCode(model.skus[M.s[j]]);
      if (!code) continue;
      rows++;
      const prev = details.get(code);
      const iso = new Date(SxxkSuspectService.SXXK_EPOCH + day * 86400000).toISOString().slice(0, 10);
      if (!prev) {
        details.set(code, { n: 1, last: iso, voucher: model.vouchers[M.v[j]] || '', reason: note.slice(0, 120), day });
      } else {
        prev.n++;
        if (day >= prev.day) {
          Object.assign(prev, { last: iso, voucher: model.vouchers[M.v[j]] || '', reason: note.slice(0, 120), day });
        }
      }
    }
    const clean = new Map<string, SxxkSuspectInfo>();
    for (const [code, d] of [...details.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      clean.set(code, { n: d.n, last: d.last, voucher: d.voucher, reason: d.reason });
    }
    return { details: clean, rows };
  }
}

/** Phần của bộ dữ liệu SXXK cần dùng (xem ton-sxxk-firebase/public/index.html). */
export interface SxxkModel {
  skus: string[];
  vouchers: string[];
  hdrs?: Record<string, { N?: string[]; X?: string[] }>;
  M: {
    s: number[];
    c: number[];
    d: Array<number | null>;
    v: number[];
    f: number[];
    r: Array<Array<unknown> | null>;
  };
}
