import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { firstValueFrom } from 'rxjs';
import { WoPxkSkipCatalogService } from './wo-pxk-skip-catalog.service';

export interface PendingPxkInfo {
  /** Tổng lượng trên PXK của các Work Order chưa Done mà web chưa scan xuất */
  qty: number;
  /** Số LSX đóng góp */
  lsx: number;
}

/** PXK chưa xuất của 1 mã + PO: tổng lượng và các LSX (Work Order chưa Done) đóng góp. */
export interface PendingPxkPo {
  qty: number;
  lsx: Array<{ lsx: string; qty: number }>;
}

/**
 * Lượng NVL còn nằm trên PXK chưa xuất (web chưa scan xuất) theo mã — dùng ở trang so sánh LinkQ
 * để giải thích lệch (LinkQ đã trừ xuất, web chưa trừ vì chưa scan).
 *
 * Chỉ ASM1, chỉ chạy khi bấm nút (đỡ lượt đọc): Work Order chưa Ready / Done (lọc theo status, tạo trong
 * 60 ngày — không cắt 7 ngày vì LSX kitting lâu hơn 1 tuần vẫn chưa xuất) → PXK (pxk-import-data) theo LSX, bỏ mã kho không cần scan (danh mục của tab Work Order)
 * → trừ lượng đã scan xuất (outbound-materials) của LSX đó → cộng phần còn lại (không âm) theo mã.
 */
@Injectable({ providedIn: 'root' })
export class LinkQPendingPxkService {
  /** Bỏ Work Order tạo quá lâu mà vẫn treo chưa Done (thường là quên đóng) */
  private static readonly WO_MAX_AGE_DAYS = 60;
  /** Work Order chưa soạn xong: Ready / Ready IQC / Transfer / Done coi như đã xuất (scan có thể thiếu) — không tính */
  private static readonly OPEN_STATUSES = ['waiting', 'kitting', 'delay'];
  private static readonly TTL_MS = 10 * 60 * 1000;
  private static readonly IN_MAX = 30;

  private cache = new Map<string, { at: number; map: Map<string, PendingPxkInfo>; byPo: Map<string, PendingPxkPo>; kitting: Map<string, string[]> }>();
  private inflight = new Map<string, Promise<{ map: Map<string, PendingPxkInfo>; byPo: Map<string, PendingPxkPo>; kitting: Map<string, string[]> }>>();

  constructor(private firestore: AngularFirestore, private skipCatalog: WoPxkSkipCatalogService) {}

  load(factory: 'ASM1' | 'ASM2' | string, force = false): Promise<Map<string, PendingPxkInfo>> {
    return this.loadAll(factory, force).then(r => r.map);
  }

  /** Lượng PXK chưa xuất theo "MÃ|PO" (PO viết hoa, bỏ khoảng trắng) — so sánh PO web với LinkQ. */
  loadByPo(factory: 'ASM1' | 'ASM2' | string, force = false): Promise<Map<string, PendingPxkPo>> {
    return this.loadAll(factory, force).then(r => r.byPo);
  }

  /** Mã có trên PXK của Work Order đang Kitting (đang scan xuất dở) → các LSX đó. */
  loadKittingCodes(factory: 'ASM1' | 'ASM2' | string, force = false): Promise<Map<string, string[]>> {
    return this.loadAll(factory, force).then(r => r.kitting);
  }

  private loadAll(factory: string, force: boolean): Promise<{ map: Map<string, PendingPxkInfo>; byPo: Map<string, PendingPxkPo>; kitting: Map<string, string[]> }> {
    const key = String(factory || '').trim().toUpperCase();
    // Chỉ tính cho ASM1 — nhà máy khác không đọc gì
    if (key !== 'ASM1') return Promise.resolve({ map: new Map(), byPo: new Map(), kitting: new Map() });
    const hit = this.cache.get(key);
    if (!force && hit && Date.now() - hit.at < LinkQPendingPxkService.TTL_MS) return Promise.resolve(hit);
    let p = this.inflight.get(key);
    if (!p) {
      p = this.compute(key)
        .then(r => {
          this.cache.set(key, { at: Date.now(), ...r });
          return r;
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  private async compute(factory: string): Promise<{ map: Map<string, PendingPxkInfo>; byPo: Map<string, PendingPxkPo>; kitting: Map<string, string[]> }> {
    const cutoffMs = Date.now() - LinkQPendingPxkService.WO_MAX_AGE_DAYS * 86400000;
    const [woSnap, skipItems] = await Promise.all([
      firstValueFrom(this.firestore.collection('work-orders', ref =>
        ref.where('status', 'in', LinkQPendingPxkService.OPEN_STATUSES)).get()),
      this.skipCatalog.load().catch(() => [])
    ]);

    // LSX của Work Order chưa Done thuộc nhà máy đang xem
    const lsxRaw = new Map<string, string>(); // norm → raw
    const kittingLsx = new Set<string>(); // norm — Work Order đang Kitting (đang scan xuất dở)
    const kitting = new Map<string, string[]>(); // mã → LSX đang Kitting có mã trên PXK
    for (const d of woSnap.docs) {
      const wo = d.data() as { productionOrder?: string; factory?: string; status?: string; isCompleted?: boolean; createdDate?: any };
      if (wo.isCompleted || !LinkQPendingPxkService.OPEN_STATUSES.includes(String(wo.status || '').toLowerCase())) continue;
      const created = wo.createdDate?.toMillis ? wo.createdDate.toMillis() : (wo.createdDate?.seconds ? wo.createdDate.seconds * 1000 : 0);
      if (created && created < cutoffMs) continue;
      const lsx = String(wo.productionOrder || '').trim();
      if (!lsx || LinkQPendingPxkService.factoryOf(wo.factory, lsx) !== factory) continue;
      const norm = LinkQPendingPxkService.normLsx(lsx);
      if (norm && !lsxRaw.has(norm)) lsxRaw.set(norm, lsx);
      if (norm && String(wo.status || '').toLowerCase() === 'kitting') kittingLsx.add(norm);
    }
    if (!lsxRaw.size) return { map: new Map(), byPo: new Map(), kitting: new Map() };

    const variants: string[] = [];
    const seen = new Set<string>();
    for (const raw of lsxRaw.values()) {
      for (const v of [raw, raw.toUpperCase()]) {
        if (!seen.has(v)) {
          seen.add(v);
          variants.push(v);
        }
      }
    }

    // PXK theo LSX: lsxNorm → mã → lượng
    const pxk = new Map<string, Map<string, number>>();
    // Đã scan xuất: lsxNorm → mã → lượng
    const scanned = new Map<string, Map<string, number>>();
    // Cùng như trên nhưng theo "MÃ|PO"
    const pxkPo = new Map<string, Map<string, number>>();
    const scannedPo = new Map<string, Map<string, number>>();
    const add = (m: Map<string, Map<string, number>>, lsx: string, code: string, q: number) => {
      let inner = m.get(lsx);
      if (!inner) m.set(lsx, (inner = new Map()));
      inner.set(code, (inner.get(code) || 0) + q);
    };

    const chunks: string[][] = [];
    for (let i = 0; i < variants.length; i += LinkQPendingPxkService.IN_MAX) {
      chunks.push(variants.slice(i, i + LinkQPendingPxkService.IN_MAX));
    }
    await Promise.all(chunks.map(async chunk => {
      const [pxkSnap, outSnap] = await Promise.all([
        firstValueFrom(this.firestore.collection('pxk-import-data', ref => ref.where('lsx', 'in', chunk)).get()),
        firstValueFrom(this.firestore.collection('outbound-materials', ref =>
          ref.where('factory', '==', factory).where('productionOrder', 'in', chunk)).get())
      ]);
      for (const doc of pxkSnap.docs) {
        const d = doc.data() as { lsx?: string; lines?: Array<Record<string, unknown>> };
        const lsx = LinkQPendingPxkService.normLsx(String(d.lsx || ''));
        if (!lsxRaw.has(lsx)) continue;
        for (const l of Array.isArray(d.lines) ? d.lines : []) {
          const code = LinkQPendingPxkService.code7(l['materialCode']);
          if (!code) continue;
          if (this.skipCatalog.isSkipWarehouse(String(l['maKho'] || ''), skipItems)) continue;
          add(pxk, lsx, code, Number(l['quantity']) || 0);
          if (kittingLsx.has(lsx)) {
            const list = kitting.get(code) || [];
            const raw = lsxRaw.get(lsx) || lsx;
            if (!list.includes(raw)) kitting.set(code, [...list, raw]);
          }
          add(pxkPo, lsx, `${code}|${LinkQPendingPxkService.po(l['po'] ?? l['poNumber'])}`, Number(l['quantity']) || 0);
        }
      }
      for (const doc of outSnap.docs) {
        const d = doc.data() as Record<string, unknown>;
        const lsx = LinkQPendingPxkService.normLsx(String(d['productionOrder'] || ''));
        const code = LinkQPendingPxkService.code7(d['materialCode']);
        if (!lsx || !code) continue;
        add(scanned, lsx, code, Number(d['exportQuantity']) || 0);
        add(scannedPo, lsx, `${code}|${LinkQPendingPxkService.po(d['poNumber'])}`, Number(d['exportQuantity']) || 0);
      }
    }));

    const out = new Map<string, PendingPxkInfo>();
    pxk.forEach((byCode, lsx) => {
      byCode.forEach((qty, code) => {
        const rest = qty - (scanned.get(lsx)?.get(code) || 0);
        if (rest <= 0.0001) return;
        const cur = out.get(code) || { qty: 0, lsx: 0 };
        cur.qty += rest;
        cur.lsx += 1;
        out.set(code, cur);
      });
    });
    out.forEach(v => (v.qty = Math.round(v.qty * 100) / 100));
    const byPo = new Map<string, PendingPxkPo>();
    pxkPo.forEach((byKey, lsx) => {
      // Kitting đang scan dở: kho có thể scan PO khác PO trên PXK → phần còn lại theo PO
      // không được vượt phần còn lại của cả mã (PXK mã − đã scan mã), dư thì chia tỉ lệ xuống.
      const poRest = new Map<string, number>();
      const sumByCode = new Map<string, number>();
      byKey.forEach((qty, key) => {
        const rest = Math.max(0, qty - (scannedPo.get(lsx)?.get(key) || 0));
        poRest.set(key, rest);
        const code = key.split('|')[0];
        sumByCode.set(code, (sumByCode.get(code) || 0) + rest);
      });
      poRest.forEach((raw, key) => {
        const code = key.split('|')[0];
        const codeRest = Math.max(0, (pxk.get(lsx)?.get(code) || 0) - (scanned.get(lsx)?.get(code) || 0));
        const sum = sumByCode.get(code) || 0;
        const rest = Math.round((sum > codeRest && sum > 0 ? raw * (codeRest / sum) : raw) * 10000) / 10000;
        if (rest <= 0.0001) return;
        const cur = byPo.get(key) || { qty: 0, lsx: [] };
        cur.qty = Math.round((cur.qty + rest) * 10000) / 10000;
        cur.lsx.push({ lsx: lsxRaw.get(lsx) || lsx, qty: rest });
        byPo.set(key, cur);
      });
    });
    return { map: out, byPo, kitting };
  }

  private static po(raw: unknown): string {
    const po = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
    // PO00000000 (toàn số 0) = không có PO → '' (giống PO trống)
    return /^PO[0\/\-.]*$/.test(po) ? '' : po;
  }

  /** Cùng quy tắc tab Work Order: cột factory (ASM1/Sample 1 → ASM1; ASM2/Sample 2/ASM3 → ASM2), không có thì theo đầu LSX (KZ → ASM1, LH → ASM2). */
  private static factoryOf(factoryCol: unknown, lsx: string): string {
    const f = String(factoryCol || '').trim().toLowerCase();
    if (f === 'asm1' || f === 'sample 1') return 'ASM1';
    if (f === 'asm2' || f === 'sample 2' || f === 'asm3') return 'ASM2';
    const u = lsx.trim().toUpperCase();
    if (u.startsWith('KZ')) return 'ASM1';
    if (u.startsWith('LH')) return 'ASM2';
    if (f.includes('asm2') || f.includes('asm3')) return 'ASM2';
    if (f.includes('asm1')) return 'ASM1';
    return '';
  }

  /** Giống normLsxForMatch của tab Work Order. */
  static normLsx(s: string): string {
    const t = String(s || '').trim().toUpperCase().replace(/\s/g, '');
    if (!t) return '';
    const compact = t.replace(/[-.]/g, '/');
    if (/^(KZ|LH)LSX/.test(compact)) return compact;
    const m = compact.match(/(\d{4}\/\d+)/);
    return m ? m[1] : compact;
  }

  /** Chuẩn hóa mã giống trang so sánh LinkQ (normalizeTieuHuyCode): viết hoa, bỏ khoảng trắng. */
  private static code7(raw: unknown): string {
    return String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  }
}
