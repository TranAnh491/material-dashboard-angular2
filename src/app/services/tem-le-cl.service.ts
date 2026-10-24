import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import { parseTemLeSplitTag } from './rm-bag-history.service';

/**
 * Tem lẻ TL / CL theo từng IMD (nhà máy + mã + PO + IMD).
 *
 * - Tách lần n: in tem TL-0n (phần đem xuất) + CL-0n (bịch còn lại). Mỗi IMD chỉ có 1 bịch CL.
 * - Chỉ được tách từ bịch chẵn (khi IMD không còn CL) hoặc từ đúng bịch CL hiện tại.
 *   Tem TL, tem CL cũ, tem lẻ kiểu cũ (T…) không tách được.
 * - Scan xuất tem CL ở tab Outbound → IMD hết CL (markClExported) → mới cho tách bịch chẵn mới.
 *
 * Trạng thái: rm-tem-le-cl/{key}; lịch sử từng lần tách: rm-tem-le-splits.
 */
export interface TemLeClState {
  factory: string;
  materialCode: string;
  po: string;
  imd: string;
  /** Số lần đã tách (TL/CL cuối cùng là seq) */
  seq: number;
  /** Đang có bịch CL trong kho */
  clActive: boolean;
  clTag: string;
  clQty: number;
  /** Nhãn bịch i/tổng của bịch CL */
  bagFraction: string;
  /** GW (gram) bịch CL cân lúc tách */
  clGw?: number;
  clGwTag?: string;
}

export interface TemLeSource {
  factory: string;
  materialCode: string;
  po: string;
  /** Số lượng trên tem vừa scan */
  quantity: number;
  /** Phần 4 QR nguyên văn */
  p4: string;
  /** IMD (DDMMYYYY / 10 số) đã tách từ phần 4 */
  imd: string;
  /** i/tổng */
  bagFraction: string;
}

export interface TemLeSplitLog {
  id: string;
  seq: number;
  /** 'CHẴN' hoặc CL-0n */
  from: string;
  fromQty: number;
  tlTag: string;
  tlQty: number;
  clTag: string;
  clQty: number;
  by: string;
  at: Date | null;
}

export interface TemLeSplitResult {
  /** id dòng lịch sử tách (rm-tem-le-splits) — để ghi GW bag CL sau khi in */
  logId: string;
  seq: number;
  tlTag: string;
  clTag: string;
  tlQty: number;
  clQty: number;
  tlQrData: string;
  clQrData: string;
}

@Injectable({ providedIn: 'root' })
export class TemLeClService {
  static readonly STATE = 'rm-tem-le-cl';
  static readonly LOG = 'rm-tem-le-splits';

  constructor(private firestore: AngularFirestore) {}

  static key(factory: string, code: string, po: string, imd: string): string {
    const n = (s: string) => String(s || '').trim().toUpperCase().replace(/[\/\s#?]+/g, '_');
    return [n(factory), n(code), n(po), n(imd)].join('__');
  }

  /** Cùng bịch (i/tổng) — tem cũ không có số bịch thì coi như cùng bịch. */
  static isSameBag(a: string, b: string): boolean {
    const x = String(a || '').trim();
    const y = String(b || '').trim();
    return !x || !y || x === y;
  }

  /** Phần 4 bỏ đuôi tách (TL/CL/T…) — dùng làm gốc cho tem mới. */
  static baseP4(p4: string): string {
    return String(p4 || '').trim()
      .replace(/\(\s*(?:TL|CL)\s*-?\s*\d{1,3}\s*\)\s*$/i, '')
      .replace(/\(\s*T\d+\s*\)\s*$/i, '')
      .trim();
  }

  async getState(factory: string, code: string, po: string, imd: string): Promise<TemLeClState | null> {
    const snap = await this.firestore.firestore.collection(TemLeClService.STATE)
      .doc(TemLeClService.key(factory, code, po, imd)).get();
    return snap.exists ? (snap.data() as TemLeClState) : null;
  }

  /**
   * Tách tem (transaction). Ném lỗi (Error.message tiếng Việt) nếu vi phạm quy tắc.
   */
  async split(src: TemLeSource, splitQtyRaw: number, by: string): Promise<TemLeSplitResult> {
    const round4 = (n: number) => Math.round(n * 10000) / 10000;
    const splitQty = round4(Number(splitQtyRaw));
    if (!Number.isFinite(splitQty) || splitQty <= 0) throw new Error('Nhập số lượng cần tách > 0.');
    if (!src.imd) throw new Error('Tem không có IMD — không tách được.');

    const tag = parseTemLeSplitTag(src.p4);
    if (tag?.kind === 'TL') throw new Error(`Tem ${tag.tag} là phần đã tách để xuất — không tách tiếp được.`);
    // Tem cũ (không đuôi, hoặc tem lẻ kiểu cũ T…) vẫn tách được — in tem TL/CL mới thay tem cũ.

    const db = this.firestore.firestore;
    const key = TemLeClService.key(src.factory, src.materialCode, src.po, src.imd);
    const stateRef = db.collection(TemLeClService.STATE).doc(key);
    const logRef = db.collection(TemLeClService.LOG).doc();

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(stateRef);
      const st = (snap.exists ? snap.data() : null) as TemLeClState | null;

      let sourceQty: number;
      let fromTag = '';
      if (tag?.kind === 'CL') {
        if (!st?.clActive || st.clTag !== tag.tag) {
          throw new Error(st?.clActive
            ? `Tem ${tag.tag} không còn là bịch CL hiện tại của IMD này (hiện là ${st.clTag}, còn ${st.clQty}).`
            : `Tem ${tag.tag} đã xuất hết — không tách được.`);
        }
        sourceQty = Number(st.clQty) || 0;
        fromTag = st.clTag;
      } else if (st?.clActive && TemLeClService.isSameBag(src.bagFraction, st.bagFraction)) {
        // Tem cũ của chính bịch CL hiện tại (chưa dán tem CL mới) → tách theo lượng CL đang ghi nhận
        sourceQty = Number(st.clQty) || 0;
        fromTag = st.clTag;
      } else {
        // Bịch chẵn: chỉ khi IMD không còn bịch CL
        if (st?.clActive) {
          throw new Error(`IMD này còn bịch ${st.clTag} (${st.clQty}). Xuất hết ${st.clTag} trước rồi mới tách bịch chẵn.`);
        }
        sourceQty = round4(Number(src.quantity) || 0);
      }
      if (splitQty >= sourceQty) {
        throw new Error(`Số lượng tách phải nhỏ hơn ${sourceQty} (bịch ${fromTag || 'chẵn'}).`);
      }

      const seq = (Number(st?.seq) || 0) + 1;
      const pad = String(seq).padStart(2, '0');
      const tlTag = `TL-${pad}`;
      const clTag = `CL-${pad}`;
      const clQty = round4(sourceQty - splitQty);
      const base = TemLeClService.baseP4(src.p4);
      const bagFraction = src.bagFraction || st?.bagFraction || '';

      const next: TemLeClState & Record<string, unknown> = {
        factory: src.factory,
        materialCode: src.materialCode,
        po: src.po,
        imd: src.imd,
        seq,
        clActive: true,
        clTag,
        clQty,
        bagFraction,
        updatedBy: by,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      tx.set(stateRef, next, { merge: true });
      tx.set(logRef, {
        key,
        factory: src.factory,
        materialCode: src.materialCode,
        po: src.po,
        imd: src.imd,
        seq,
        from: fromTag || 'CHẴN',
        fromQty: sourceQty,
        tlTag,
        tlQty: splitQty,
        clTag,
        clQty,
        by,
        at: firebase.firestore.FieldValue.serverTimestamp()
      });

      return {
        logId: logRef.id,
        seq,
        tlTag,
        clTag,
        tlQty: splitQty,
        clQty,
        tlQrData: `${src.materialCode}|${src.po}|${splitQty}|${base}(${tlTag})`,
        clQrData: `${src.materialCode}|${src.po}|${clQty}|${base}(${clTag})`
      };
    });
  }

  static readonly GW_SUSPECTS = 'tem-le-gw-suspects';

  /**
   * Ghi kết quả cân GW bag CL (+ bịch TL có hình, nếu có) vào dòng lịch sử tách;
   * lệch > 5% (hoặc bỏ qua) → thêm vào danh mục nghi ngờ.
   */
  async saveGwCheck(logId: string, data: {
    factory: string; materialCode: string; po: string; imd: string; clTag: string; clQty: number;
    fullQty: number; gwBagFull: number; gwCl: number | null; gwExpected: number | null; devPct: number | null;
    ok: boolean; reason: string; by: string;
    tlTag?: string; tlQty?: number; gwTl?: number | null; gwTlExpected?: number | null; tlDevPct?: number | null;
    tlOk?: boolean | null; tlGwOcr?: number | null; tlPhotoUrl?: string; tlPhotoPath?: string;
  }): Promise<void> {
    const db = this.firestore.firestore;
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    // GW bịch CL hiện tại — xem lại ở popup bag (Materials)
    if (data.gwCl != null) {
      batch.set(db.collection(TemLeClService.STATE).doc(TemLeClService.key(data.factory, data.materialCode, data.po, data.imd)), {
        clGw: data.gwCl, clGwTag: data.clTag, clGwBy: data.by, clGwAt: now
      }, { merge: true });
    }
    if (logId) {
      batch.set(db.collection(TemLeClService.LOG).doc(logId), {
        gwCl: data.gwCl, gwExpected: data.gwExpected, gwBagFull: data.gwBagFull, gwDevPct: data.devPct,
        gwOk: data.ok, gwBy: data.by, gwAt: now,
        ...(data.gwTl != null ? {
          gwTl: data.gwTl, gwTlExpected: data.gwTlExpected ?? null, gwTlDevPct: data.tlDevPct ?? null,
          gwTlOk: data.tlOk ?? null, gwTlOcr: data.tlGwOcr ?? null,
          tlPhotoUrl: data.tlPhotoUrl || '', tlPhotoPath: data.tlPhotoPath || ''
        } : {})
      }, { merge: true });
    }
    if (!data.ok) {
      batch.set(db.collection(TemLeClService.GW_SUSPECTS).doc(), { ...data, logId, emailed: false, at: now });
    }
    await batch.commit();
  }

  /** Danh mục nghi ngờ sai lệch GW (mới nhất trước). */
  async listGwSuspects(limit = 300): Promise<any[]> {
    const snap = await this.firestore.firestore.collection(TemLeClService.GW_SUSPECTS)
      .orderBy('at', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  }

  /** Kết quả cân bịch TL (có hình) lúc tách — null nếu lần tách đó chưa cân TL hoặc đã hủy. */
  async getTlWeigh(factory: string, code: string, po: string, imd: string, tlTag: string): Promise<{
    tlTag: string; tlQty: number; tlGw: number; gwBagFull: number; photoUrl: string; photoPath: string; by: string;
  } | null> {
    const key = TemLeClService.key(factory, code, po, imd);
    const snap = await this.firestore.firestore.collection(TemLeClService.LOG).where('key', '==', key).get();
    const r = snap.docs
      .map((d) => d.data() as any)
      .filter((x) => !x.undone && String(x.tlTag || '') === tlTag && Number(x.gwTl) > 0)
      .sort((a, b) => (Number(b.seq) || 0) - (Number(a.seq) || 0))[0];
    if (!r) return null;
    return {
      tlTag,
      tlQty: Number(r.tlQty) || 0,
      tlGw: Number(r.gwTl) || 0,
      gwBagFull: Number(r.gwBagFull) || 0,
      photoUrl: String(r.tlPhotoUrl || ''),
      photoPath: String(r.tlPhotoPath || ''),
      by: String(r.gwBy || r.by || '')
    };
  }

  /** Lần tách gần nhất (chưa hủy) của 1 IMD. */
  async getLastSplit(factory: string, code: string, po: string, imd: string): Promise<TemLeSplitLog | null> {
    const key = TemLeClService.key(factory, code, po, imd);
    const snap = await this.firestore.firestore.collection(TemLeClService.LOG).where('key', '==', key).get();
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((r) => !r.undone)
      .sort((a, b) => (Number(b.seq) || 0) - (Number(a.seq) || 0));
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      seq: Number(r.seq) || 0,
      from: String(r.from || ''),
      fromQty: Number(r.fromQty) || 0,
      tlTag: String(r.tlTag || ''),
      tlQty: Number(r.tlQty) || 0,
      clTag: String(r.clTag || ''),
      clQty: Number(r.clQty) || 0,
      by: String(r.by || ''),
      at: r.at?.toDate ? r.at.toDate() : null
    };
  }

  /**
   * Hủy lần tách gần nhất (tách sai, TL chưa xuất): trả IMD về trạng thái trước lần tách.
   * Tem TL/CL của lần đó bỏ đi, không dùng nữa.
   */
  async undoLastSplit(factory: string, code: string, po: string, imd: string, logId: string, by: string): Promise<void> {
    const db = this.firestore.firestore;
    const stateRef = db.collection(TemLeClService.STATE).doc(TemLeClService.key(factory, code, po, imd));
    const logRef = db.collection(TemLeClService.LOG).doc(logId);
    await db.runTransaction(async (tx) => {
      const [stSnap, logSnap] = await Promise.all([tx.get(stateRef), tx.get(logRef)]);
      const st = (stSnap.exists ? stSnap.data() : null) as TemLeClState | null;
      const log = (logSnap.exists ? logSnap.data() : null) as any;
      if (!st || !log || log.undone) throw new Error('Không tìm thấy lần tách để hủy.');
      if (!st.clActive || st.clTag !== log.clTag || Number(st.seq) !== Number(log.seq)) {
        throw new Error(`Chỉ hủy được lần tách mới nhất khi bịch ${log.clTag} chưa xuất.`);
      }
      const fromCl = /^CL-\d+$/.test(String(log.from || ''));
      tx.set(stateRef, {
        seq: Math.max(0, Number(log.seq) - 1),
        clActive: fromCl,
        clTag: fromCl ? log.from : '',
        clQty: fromCl ? Number(log.fromQty) || 0 : 0,
        updatedBy: by,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      tx.update(logRef, {
        undone: true,
        undoneBy: by,
        undoneAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  }

  /**
   * Xuất bằng tem cũ (không đuôi TL/CL) ở Outbound: nếu đúng bịch đang là CL và lượng xuất ≥ lượng CL
   * thì IMD hết CL. Không có CL đang mở thì không đọc/ghi gì thêm ngoài 1 lần đọc trạng thái.
   */
  async markClExportedByOldLabel(
    factory: string, code: string, po: string, imd: string, bagFraction: string, qty: number, by: string
  ): Promise<void> {
    const st = await this.getState(factory, code, po, imd);
    if (!st?.clActive || !TemLeClService.isSameBag(bagFraction, st.bagFraction)) return;
    if (!(qty > 0) || qty + 1e-6 < (Number(st.clQty) || 0)) return;
    await this.markClExported(factory, code, po, imd, st.clTag, by);
  }

  /** Scan xuất tem CL (tab Outbound) → IMD không còn bịch CL. Bỏ qua nếu tem không phải CL hiện tại. */
  async markClExported(factory: string, code: string, po: string, imd: string, clTag: string, by: string): Promise<void> {
    const db = this.firestore.firestore;
    const ref = db.collection(TemLeClService.STATE).doc(TemLeClService.key(factory, code, po, imd));
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const st = (snap.exists ? snap.data() : null) as TemLeClState | null;
      if (!st?.clActive || st.clTag !== clTag) return;
      tx.set(ref, {
        clActive: false,
        clQty: 0,
        exportedTag: clTag,
        exportedBy: by,
        exportedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
  }
}
