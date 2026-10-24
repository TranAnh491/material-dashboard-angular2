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

/**
 * Lượng NVL còn nằm trên PXK chưa xuất (web chưa scan xuất) theo mã — dùng ở trang so sánh LinkQ
 * để giải thích lệch (LinkQ đã trừ xuất, web chưa trừ vì chưa scan).
 *
 * Chỉ ASM1, chỉ chạy khi bấm nút (đỡ lượt đọc): Work Order chưa Done (lọc theo status, tạo trong
 * 60 ngày — không cắt 7 ngày vì LSX kitting lâu hơn 1 tuần vẫn chưa xuất) → PXK (pxk-import-data) theo LSX, bỏ mã kho không cần scan (danh mục của tab Work Order)
 * → trừ lượng đã scan xuất (outbound-materials) của LSX đó → cộng phần còn lại (không âm) theo mã.
 */
@Injectable({ providedIn: 'root' })
export class LinkQPendingPxkService {
  /** Bỏ Work Order tạo quá lâu mà vẫn treo chưa Done (thường là quên đóng) */
  private static readonly WO_MAX_AGE_DAYS = 60;
  /** Trạng thái Work Order chưa Done (WorkOrderStatus trừ 'done') — query theo status, không cần index ghép */
  private static readonly OPEN_STATUSES = ['waiting', 'kitting', 'ready', 'ready-iqc', 'transfer', 'delay'];
  private static readonly TTL_MS = 10 * 60 * 1000;
  private static readonly IN_MAX = 30;

  private cache = new Map<string, { at: number; map: Map<string, PendingPxkInfo> }>();
  private inflight = new Map<string, Promise<Map<string, PendingPxkInfo>>>();

  constructor(private firestore: AngularFirestore, private skipCatalog: WoPxkSkipCatalogService) {}

  load(factory: 'ASM1' | 'ASM2' | string, force = false): Promise<Map<string, PendingPxkInfo>> {
    const key = String(factory || '').trim().toUpperCase();
    // Chỉ tính cho ASM1 — nhà máy khác không đọc gì
    if (key !== 'ASM1') return Promise.resolve(new Map());
    const hit = this.cache.get(key);
    if (!force && hit && Date.now() - hit.at < LinkQPendingPxkService.TTL_MS) return Promise.resolve(hit.map);
    let p = this.inflight.get(key);
    if (!p) {
      p = this.compute(key)
        .then(map => {
          this.cache.set(key, { at: Date.now(), map });
          return map;
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  private async compute(factory: string): Promise<Map<string, PendingPxkInfo>> {
    const cutoffMs = Date.now() - LinkQPendingPxkService.WO_MAX_AGE_DAYS * 86400000;
    const [woSnap, skipItems] = await Promise.all([
      firstValueFrom(this.firestore.collection('work-orders', ref =>
        ref.where('status', 'in', LinkQPendingPxkService.OPEN_STATUSES)).get()),
      this.skipCatalog.load().catch(() => [])
    ]);

    // LSX của Work Order chưa Done thuộc nhà máy đang xem
    const lsxRaw = new Map<string, string>(); // norm → raw
    for (const d of woSnap.docs) {
      const wo = d.data() as { productionOrder?: string; factory?: string; status?: string; isCompleted?: boolean; createdDate?: any };
      if (wo.isCompleted || String(wo.status || '').toLowerCase() === 'done') continue;
      const created = wo.createdDate?.toMillis ? wo.createdDate.toMillis() : (wo.createdDate?.seconds ? wo.createdDate.seconds * 1000 : 0);
      if (created && created < cutoffMs) continue;
      const lsx = String(wo.productionOrder || '').trim();
      if (!lsx || LinkQPendingPxkService.factoryOf(wo.factory, lsx) !== factory) continue;
      const norm = LinkQPendingPxkService.normLsx(lsx);
      if (norm && !lsxRaw.has(norm)) lsxRaw.set(norm, lsx);
    }
    if (!lsxRaw.size) return new Map();

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
        }
      }
      for (const doc of outSnap.docs) {
        const d = doc.data() as Record<string, unknown>;
        const lsx = LinkQPendingPxkService.normLsx(String(d['productionOrder'] || ''));
        const code = LinkQPendingPxkService.code7(d['materialCode']);
        if (!lsx || !code) continue;
        add(scanned, lsx, code, Number(d['exportQuantity']) || 0);
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
    return out;
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
