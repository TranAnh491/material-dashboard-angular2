import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';

/** Thông tin 1 tem để giữ khoá chống trùng. */
export interface ScanLockTem {
  factory: string;
  materialCode: string;
  poNumber: string;
  /** Phần 4 của QR (IMD + bịch / bag) — đúng nguyên văn trên tem */
  tem: string | null | undefined;
  /** Nhãn bịch (vd 3/12) */
  bagBatch?: string | null;
  /** Số bag hiển thị */
  bagNumberDisplay?: string | null;
}

interface LockDoc {
  factory: string;
  materialCode: string;
  poNumber: string;
  tem: string;
  lsx: string;
  employeeId: string;
  sessionId: string;
  status: 'pending' | 'saved';
  at: any;
  savedAt?: any;
}

/**
 * Chống trùng tem khi scan xuất (Outbound) — chặn NGAY lúc scan, không đợi quét trùng 12h / 17h.
 *
 * Mỗi tem có số bag → 1 doc `outbound-scan-locks/{factory|mã|PO|tem}`:
 * - scan nhận tem → giữ khoá `pending` cho LSX + phiên trang đang scan;
 * - LSX khác / máy khác scan cùng tem lúc khoá còn hiệu lực (< 3 giờ) → báo đỏ, không nhận;
 * - lưu xuất xong → khoá `saved`: tem đó không xuất lại được nữa;
 * - xoá dòng scan / huỷ phiên → trả khoá.
 * Tem không có số bag và mã nằm trong danh mục loại trừ của Control Batch → không khoá (giống quét trùng 12h / 17h).
 */
@Injectable({ providedIn: 'root' })
export class OutboundScanLockService {
  static readonly COLLECTION = 'outbound-scan-locks';
  /** Khoá pending quá hạn này coi như bỏ (máy tắt giữa chừng) */
  static readonly PENDING_TTL_MS = 3 * 60 * 60 * 1000;
  private static readonly SESSION_KEY = 'outboundScanLockSession';

  readonly sessionId: string = OutboundScanLockService.loadSessionId();
  private exclusion: { enabled: boolean; codes: string[] } | null = null;
  private exclusionAt = 0;

  constructor(private firestore: AngularFirestore) {}

  private static loadSessionId(): string {
    try {
      const saved = sessionStorage.getItem(OutboundScanLockService.SESSION_KEY);
      if (saved) return saved;
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(OutboundScanLockService.SESSION_KEY, id);
      return id;
    } catch {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  /** Tem có số bag mới khoá (giống điều kiện quét trùng ở functions/outbound-dup-notify). */
  private hasBagInfo(t: ScanLockTem): boolean {
    return /\d/.test(String(t.bagBatch || '')) || !!String(t.bagNumberDisplay || '').trim();
  }

  /** null = tem không cần khoá. */
  keyOf(t: ScanLockTem): string | null {
    const tem = String(t.tem || '').trim();
    const code = String(t.materialCode || '').trim().toUpperCase();
    const po = String(t.poNumber || '').trim();
    if (!tem || !code || !po || po === 'Unknown' || !this.hasBagInfo(t)) return null;
    const raw = `${String(t.factory || '').trim().toUpperCase()}|${code}|${po}|${tem}`;
    return raw.replace(/[\/#\[\]\.\s]+/g, '_').slice(0, 1400);
  }

  /** Danh mục loại trừ của Control Batch (đọc lại mỗi 10 phút). */
  private async isExcluded(code: string): Promise<boolean> {
    if (!this.exclusion || Date.now() - this.exclusionAt > 10 * 60 * 1000) {
      try {
        const snap = await this.firestore.firestore.doc('control-batch-exclusion/settings').get();
        const d = (snap.data() || {}) as any;
        this.exclusion = {
          enabled: d.excludeEnabled === true,
          codes: (Array.isArray(d.excludeMaterialCodes) ? d.excludeMaterialCodes : [])
            .map((c: any) => String(c || '').trim().toUpperCase()).filter(Boolean)
        };
        this.exclusionAt = Date.now();
      } catch {
        this.exclusion = this.exclusion || { enabled: false, codes: [] };
      }
    }
    if (!this.exclusion.enabled) return false;
    const mc = String(code || '').trim().toUpperCase();
    return this.exclusion.codes.some((ex) => (ex.length === 4 ? mc.startsWith(ex) : mc === ex));
  }

  private toMs(v: any): number {
    if (!v) return 0;
    if (v instanceof Date) return v.getTime();
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    const n = new Date(v).getTime();
    return Number.isFinite(n) ? n : 0;
  }

  private fmt(v: any): string {
    const ms = this.toMs(v);
    return ms ? new Date(ms).toLocaleString('vi-VN', { hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  }

  /**
   * Giữ khoá cho tem vừa scan. Trả về thông báo lỗi (chặn) hoặc null (nhận tem).
   * Lỗi mạng → chặn, bắt scan lại.
   */
  async claim(t: ScanLockTem, lsx: string, employeeId: string): Promise<string | null> {
    const key = this.keyOf(t);
    if (!key) return null;
    const code = String(t.materialCode || '').trim().toUpperCase();
    const lsxNorm = String(lsx || '').trim().toUpperCase();
    try {
      if (await this.isExcluded(code)) return null;
      const db = this.firestore.firestore;
      const ref = db.collection(OutboundScanLockService.COLLECTION).doc(key);
      return await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          const d = snap.data() as LockDoc;
          const label = `${code} · PO ${d.poNumber || t.poNumber} · tem ${d.tem || t.tem}`;
          if (d.status === 'saved') {
            return `TRÙNG TEM — ${label} đã xuất ở LSX ${d.lsx || '—'} lúc ${this.fmt(d.savedAt || d.at)} (${d.employeeId || '—'}). Không cho xuất lại.`;
          }
          const fresh = Date.now() - this.toMs(d.at) < OutboundScanLockService.PENDING_TTL_MS;
          const other = String(d.lsx || '').trim().toUpperCase() !== lsxNorm || d.sessionId !== this.sessionId;
          if (fresh && other) {
            return `TRÙNG TEM — ${label} đang được LSX ${d.lsx || '—'} scan (${d.employeeId || '—'}, lúc ${this.fmt(d.at)}). ` +
              `2 LSX / 2 máy không được scan cùng 1 tem.`;
          }
        }
        const doc: LockDoc = {
          factory: String(t.factory || '').trim(),
          materialCode: code,
          poNumber: String(t.poNumber || '').trim(),
          tem: String(t.tem || '').trim(),
          lsx: String(lsx || '').trim(),
          employeeId: String(employeeId || '').trim().toUpperCase(),
          sessionId: this.sessionId,
          status: 'pending',
          at: new Date()
        };
        tx.set(ref, doc);
        return null;
      });
    } catch (e: any) {
      console.warn('[OutboundScanLock] claim', e);
      return `Không kiểm tra được trùng tem ${code} (lỗi mạng) — kiểm tra mạng rồi scan lại.`;
    }
  }

  /** Trả khoá pending của phiên này (xoá dòng scan / huỷ phiên). Lỗi bỏ qua — khoá tự hết hạn sau 3 giờ. */
  async release(tems: ScanLockTem[]): Promise<void> {
    const keys = Array.from(new Set(tems.map((t) => this.keyOf(t)).filter((k): k is string => !!k)));
    if (!keys.length) return;
    const db = this.firestore.firestore;
    await Promise.all(keys.map(async (key) => {
      try {
        const ref = db.collection(OutboundScanLockService.COLLECTION).doc(key);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return;
          const d = snap.data() as LockDoc;
          if (d.status === 'pending' && d.sessionId === this.sessionId) tx.delete(ref);
        });
      } catch (e) {
        console.warn('[OutboundScanLock] release', key, e);
      }
    }));
  }

  /** Đã lưu xuất → khoá vĩnh viễn (status saved). Lỗi chỉ cảnh báo, không chặn lưu. */
  async markSaved(tems: ScanLockTem[], lsx: string, employeeId: string): Promise<void> {
    const list = tems
      .map((t) => ({ t, key: this.keyOf(t) }))
      .filter((x): x is { t: ScanLockTem; key: string } => !!x.key);
    if (!list.length) return;
    const db = this.firestore.firestore;
    const now = new Date();
    for (let i = 0; i < list.length; i += 400) {
      const batch = db.batch();
      for (const { t, key } of list.slice(i, i + 400)) {
        batch.set(db.collection(OutboundScanLockService.COLLECTION).doc(key), {
          factory: String(t.factory || '').trim(),
          materialCode: String(t.materialCode || '').trim().toUpperCase(),
          poNumber: String(t.poNumber || '').trim(),
          tem: String(t.tem || '').trim(),
          lsx: String(lsx || '').trim(),
          employeeId: String(employeeId || '').trim().toUpperCase(),
          sessionId: this.sessionId,
          status: 'saved',
          savedAt: now
        }, { merge: true });
      }
      try {
        await batch.commit();
      } catch (e) {
        console.warn('[OutboundScanLock] markSaved', e);
      }
    }
  }
}
