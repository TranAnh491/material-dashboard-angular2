import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { MaterialLifecycleService } from './material-lifecycle.service';

/** Đồng bộ cột Người soạn (work-orders) từ người scan xuất kho + tên Settings (users). */
@Injectable({ providedIn: 'root' })
export class WorkOrderOutboundCreatedByService {
  private zaloNameByMemberId = new Map<string, string>();
  private zaloCacheLoadedAt = 0;
  private readonly ZALO_CACHE_TTL_MS = 10 * 60 * 1000;
  private settingsNameByMemberId = new Map<string, string>();
  private settingsCacheLoadedAt = 0;
  private readonly SETTINGS_CACHE_TTL_MS = 10 * 60 * 1000;

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
    const emailMatch = t.toLowerCase().match(/^asp(\d{4})@/);
    if (emailMatch) return `ASP${emailMatch[1]}`;
    const embedded = t.toUpperCase().match(/ASP(\d{4})/);
    if (embedded) return `ASP${embedded[1]}`;
    return t.toUpperCase();
  }

  normLsxForMatch(s: string): string {
    const t = String(s || '').trim().toUpperCase().replace(/\s/g, '');
    if (!t) return '';
    const compact = t.replace(/[-.]/g, '/');
    if (/^(KZ|LH)LSX/.test(compact)) return compact;
    const m = compact.match(/(\d{4}\/\d+)/);
    return m ? m[1] : compact;
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

  /** Tên nhân viên từ Settings (users.displayName theo mã ASP). */
  async getSettingsNameMap(): Promise<Map<string, string>> {
    const now = Date.now();
    if (this.settingsNameByMemberId.size > 0 && now - this.settingsCacheLoadedAt < this.SETTINGS_CACHE_TTL_MS) {
      return this.settingsNameByMemberId;
    }
    const map = new Map<string, string>();
    const add = (employeeId?: string, displayName?: string, email?: string) => {
      const name = String(displayName || '').trim();
      if (!name) return;
      const fromEmp = this.normalizeMemberId(employeeId || '');
      const fromEmail = this.normalizeMemberId(email || '');
      const mid =
        fromEmp.startsWith('ASP') && fromEmp.length === 7
          ? fromEmp
          : fromEmail.startsWith('ASP') && fromEmail.length === 7
            ? fromEmail
            : '';
      if (!mid) return;
      if (!map.has(mid)) map.set(mid, name);
    };
    try {
      const snap = await this.firestore.collection('users').get().toPromise();
      (snap?.docs || []).forEach(doc => {
        const d = doc.data() as { employeeId?: string; displayName?: string; email?: string };
        add(d.employeeId, d.displayName, d.email);
      });
    } catch (e) {
      console.warn('[WO createdBy] Không load users (Settings):', e);
    }
    try {
      const snap = await this.firestore.collection('user-permissions').get().toPromise();
      (snap?.docs || []).forEach(doc => {
        const d = doc.data() as { employeeId?: string; displayName?: string; email?: string };
        add(d.employeeId, d.displayName, d.email);
      });
    } catch {
      // user-permissions không bắt buộc
    }
    this.settingsNameByMemberId = map;
    this.settingsCacheLoadedAt = now;
    return map;
  }

  async resolveDisplayName(employeeId: string): Promise<string> {
    const mid = this.normalizeMemberId(employeeId);
    if (!mid) return '';
    const settings = await this.getSettingsNameMap();
    const fromSettings = settings.get(mid);
    if (fromSettings) return fromSettings;
    const zalo = await this.getZaloNameMap();
    return zalo.get(mid) || mid;
  }

  /** Mã NV scan mới nhất theo LSX (outbound-materials). Key = LSX đã chuẩn hóa. */
  async loadLatestMemberIdByLsx(
    factory: 'ASM1' | 'ASM2',
    lsxRawList: string[]
  ): Promise<Map<string, string>> {
    const unique = [...new Set(lsxRawList.map(s => String(s || '').trim()).filter(Boolean))];
    const result = new Map<string, string>();
    const at = new Map<string, number>();
    if (unique.length === 0) return result;

    const FIRESTORE_IN_MAX = 30;
    try {
      for (let i = 0; i < unique.length; i += FIRESTORE_IN_MAX) {
        const chunk = unique.slice(i, i + FIRESTORE_IN_MAX);
        const snap = await this.firestore
          .collection('outbound-materials', ref =>
            ref.where('factory', '==', factory).where('productionOrder', 'in', chunk)
          )
          .get()
          .toPromise();
        (snap?.docs || []).forEach(doc => {
          const d = doc.data() as {
            productionOrder?: string;
            employeeId?: string;
            exportedBy?: string;
            exportDate?: unknown;
            createdAt?: unknown;
          };
          const poNorm = this.normLsxForMatch(d.productionOrder || '');
          if (!poNorm) return;
          const memberId = this.normalizeMemberId(String(d.employeeId || d.exportedBy || ''));
          if (!memberId || memberId === 'BS') return;
          const exportMs = this.parseExportDateMs(d.exportDate || d.createdAt);
          if (exportMs >= (at.get(poNorm) || 0)) {
            result.set(poNorm, memberId);
            at.set(poNorm, exportMs);
          }
        });
      }
    } catch (e) {
      console.warn('[WO createdBy] loadLatestMemberIdByLsx failed:', factory, e);
    }
    return result;
  }

  private async findWorkOrder(
    factory: 'ASM1' | 'ASM2',
    lsx: string
  ): Promise<{ id: string; createdBy?: string; createdByFromOutbound?: boolean } | null> {
    const lsxTrim = lsx.trim();
    const lsxNorm = this.normLsxForMatch(lsxTrim);

    const toWoList = (snap: { docs?: { id: string; data: () => object }[] } | undefined) =>
      (snap?.docs || []).map(d => ({ id: d.id, ...d.data() })) as Array<{
        id: string;
        productionOrder?: string;
        createdBy?: string;
        createdByFromOutbound?: boolean;
      }>;

    const findMatch = (
      list: { id: string; productionOrder?: string; createdBy?: string; createdByFromOutbound?: boolean }[]
    ) =>
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
      if (match) return match;

      snap = await this.firestore
        .collection('work-orders', ref => ref.where('productionOrder', '==', lsxTrim).limit(10))
        .get()
        .toPromise();
      match = findMatch(toWoList(snap as any));
      return match || null;
    } catch (e) {
      console.warn('[WO createdBy] findWorkOrder failed:', e);
      return null;
    }
  }

  /** Sau khi xuất kho: cập nhật Người soạn = tên Settings theo mã nhân viên scan (không đè lựa chọn tay). */
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

    const wo = await this.findWorkOrder(factory, lsx);
    if (!wo) {
      console.log(`[WO createdBy] Không tìm WO cho LSX ${lsx}`);
      return;
    }

    const hasManual = String(wo.createdBy || '').trim() !== '' && !wo.createdByFromOutbound;
    if (hasManual) {
      try {
        await this.materialService.updateWorkOrder(wo.id, { createdByMemberId: mid } as any);
      } catch (e) {
        console.warn('[WO createdBy] update memberId failed:', e);
      }
      return;
    }

    try {
      await this.materialService.updateWorkOrder(wo.id, {
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
