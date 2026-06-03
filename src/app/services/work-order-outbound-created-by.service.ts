import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { MaterialLifecycleService } from './material-lifecycle.service';

/** Đồng bộ cột Người soạn (work-orders) từ người scan xuất kho + tên zalo_links. */
@Injectable({ providedIn: 'root' })
export class WorkOrderOutboundCreatedByService {
  private zaloNameByMemberId = new Map<string, string>();
  private zaloCacheLoadedAt = 0;
  private readonly ZALO_CACHE_TTL_MS = 10 * 60 * 1000;

  constructor(
    private firestore: AngularFirestore,
    private materialService: MaterialLifecycleService
  ) {}

  /** ASP + 4 số — 7 ký tự đầu từ QR nhân viên. */
  normalizeMemberId(raw: string): string {
    const t = String(raw || '').trim();
    if (!t) return '';
    const id = t.substring(0, 7).toUpperCase();
    if (id.length === 7 && id.startsWith('ASP') && /^\d{4}$/.test(id.substring(3))) {
      return id;
    }
    return t.toUpperCase();
  }

  normLsxForMatch(s: string): string {
    const t = String(s || '').trim().toUpperCase().replace(/\s/g, '');
    const m = t.match(/(\d{4}[\/\-\.]\d+)/);
    return m ? m[1].replace(/[-.]/g, '/') : t;
  }

  private parseExportDateMs(v: unknown): number {
    if (!v) return 0;
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'object' && v !== null && 'toDate' in v) {
      try {
        return (v as { toDate: () => Date }).toDate().getTime();
      } catch {
        return 0;
      }
    }
    if (typeof v === 'object' && v !== null && 'seconds' in v) {
      return Number((v as { seconds: number }).seconds) * 1000;
    }
    const d = new Date(v as string | number);
    return Number.isFinite(d.getTime()) ? d.getTime() : 0;
  }

  async getZaloNameMap(): Promise<Map<string, string>> {
    const now = Date.now();
    if (this.zaloNameByMemberId.size > 0 && now - this.zaloCacheLoadedAt < this.ZALO_CACHE_TTL_MS) {
      return this.zaloNameByMemberId;
    }
    const map = new Map<string, string>();
    try {
      const snap = await this.firestore.collection('zalo_links').get().toPromise();
      (snap?.docs || []).forEach(doc => {
        const d = doc.data() as { memberId?: string; name?: string };
        const mid = this.normalizeMemberId(d.memberId || '');
        const name = String(d.name || '').trim();
        if (mid && name && !map.has(mid)) {
          map.set(mid, name);
        }
      });
    } catch (e) {
      console.warn('[WO createdBy] Không load zalo_links:', e);
    }
    this.zaloNameByMemberId = map;
    this.zaloCacheLoadedAt = now;
    return map;
  }

  async resolveDisplayName(employeeId: string): Promise<string> {
    const mid = this.normalizeMemberId(employeeId);
    if (!mid) return '';
    const map = await this.getZaloNameMap();
    return map.get(mid) || mid;
  }

  private async findWorkOrderId(factory: 'ASM1' | 'ASM2', lsx: string): Promise<string | null> {
    const lsxTrim = lsx.trim();
    const lsxNorm = this.normLsxForMatch(lsxTrim);

    const toWoList = (snap: { docs?: { id: string; data: () => object }[] } | undefined) =>
      (snap?.docs || []).map(d => ({ id: d.id, ...d.data() }));

    const findMatch = (list: { id: string; productionOrder?: string }[]) =>
      list.find(wo => {
        const po = String(wo.productionOrder || '').trim();
        if (!po) return false;
        return (
          this.normLsxForMatch(po) === lsxNorm ||
          po.toUpperCase() === lsxTrim.toUpperCase()
        );
      });

    try {
      let snap = await this.firestore
        .collection('work-orders', ref =>
          ref.where('factory', '==', factory).where('productionOrder', '==', lsxTrim).limit(5)
        )
        .get()
        .toPromise();
      let match = findMatch(toWoList(snap as any));
      if (match) return match.id;

      snap = await this.firestore
        .collection('work-orders', ref => ref.where('productionOrder', '==', lsxTrim).limit(10))
        .get()
        .toPromise();
      match = findMatch(toWoList(snap as any));
      return match?.id || null;
    } catch (e) {
      console.warn('[WO createdBy] findWorkOrderId failed:', e);
      return null;
    }
  }

  /** Sau khi xuất kho: cập nhật Người soạn = tên zalo_links theo mã nhân viên scan. */
  async syncFromOutboundScan(
    factory: 'ASM1' | 'ASM2',
    productionOrder: string,
    employeeId: string
  ): Promise<void> {
    const lsx = String(productionOrder || '').trim();
    const mid = this.normalizeMemberId(employeeId);
    if (!lsx || !mid) return;

    const displayName = await this.resolveDisplayName(mid);
    if (!displayName) return;

    const woId = await this.findWorkOrderId(factory, lsx);
    if (!woId) {
      console.log(`[WO createdBy] Không tìm WO cho LSX ${lsx}`);
      return;
    }

    try {
      await this.materialService.updateWorkOrder(woId, {
        createdBy: displayName,
        createdByFromOutbound: true,
        createdByMemberId: mid
      } as any);
      console.log(`[WO createdBy] ${lsx} → ${displayName} (${mid})`);
    } catch (e) {
      console.warn('[WO createdBy] updateWorkOrder failed:', e);
    }
  }
}
