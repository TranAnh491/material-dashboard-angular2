import { Injectable } from '@angular/core';
import { stripJ5Prefix } from '../shared/location-prefix';
import { KkCatalogService } from './kk-catalog.service';

/**
 * Rule vị trí dùng chung cho màn hình scan "Cập nhật vị trí" (tab Location) và "Kiểm kê" (tab Quản lý NVL).
 * Cùng logic với tab Location: ASM1 theo Sơ đồ lưu trữ (J-Warehouse), mã chưa ghi trên sơ đồ → vị trí Danh mục;
 * ASM2 không ép vị trí. IQC / BOX / Locker / Backup / pallet F1-F2 / ASM3 không áp rule.
 */
@Injectable({ providedIn: 'root' })
export class LocationScanRulesService {
  private typeMap = new Map<string, string>();
  private homeLocs = new Map<string, string>();
  private ready = false;
  private loading: Promise<void> | null = null;

  constructor(private kkCatalog: KkCatalogService) {}

  /** Nạp Sơ đồ lưu trữ + danh mục vị trí (gọi khi mở màn hình scan). */
  load(): Promise<void> {
    if (!this.loading) {
      this.loading = Promise.all([
        this.kkCatalog.loadShelfMap(),
        this.kkCatalog.loadAllAsMap(),
        this.kkCatalog.loadHomeLocs()
      ])
        .then(([, typeMap, homeLocs]) => {
          this.typeMap = typeMap;
          this.homeLocs = homeLocs;
          this.ready = true;
        })
        .catch((e) => console.warn('[LocationScanRules] load failed', e))
        .finally(() => { this.loading = null; });
    }
    return this.loading;
  }

  private compact(raw: string): string {
    return String(raw || '').replace(/\s/g, '').toUpperCase();
  }

  isIqcExempt(loc: string): boolean { return this.compact(loc).startsWith('IQC'); }
  /** Vị trí PASS (hàng đã QC đạt, chờ lên kệ): mọi mã đều được scan / kiểm kê tại đây. */
  isPassExempt(loc: string): boolean { return /^PASS(?![A-Z])/.test(this.compact(loc)); }
  isBoxExempt(loc: string): boolean { return /^BOX-\d/.test(this.compact(loc)); }
  isLockerBackupExempt(loc: string): boolean {
    const raw = this.compact(loc);
    return /^LOCKER(?:\+?\d+)?$/.test(raw) || /^BACKUP(?:-?\d+)?$/.test(raw);
  }
  private isPalletCode(loc: string): boolean { return /^F[12]-/.test(this.compact(loc)); }

  private formatViTri(input: string): string {
    return String(input || '').replace(/\s/g, '').toUpperCase().replace(/[^A-Z0-9.\-()]/g, '');
  }

  validate(loc: string): boolean {
    return !!loc && /^[A-Z0-9.\-()]+$/.test(loc);
  }

  /** Chuẩn hóa vị trí vừa scan; useAsm3 → thêm tiền tố ASM3+. */
  normalizeTarget(raw: string, useAsm3: boolean): string {
    const compact = stripJ5Prefix(String(raw || '').trim()).trim().replace(/\s+/g, '').toUpperCase().replace(/[^A-Z0-9.\-()+]/g, '');
    if (!compact) return '';
    if (useAsm3) {
      const body = compact.replace(/^ASM3[+_-]?/, '');
      return body ? `ASM3+${body}` : '';
    }
    if (this.isPalletCode(compact)) return compact;
    return this.formatViTri(compact);
  }

  isExempt(loc: string, useAsm3: boolean): boolean {
    const raw = this.compact(loc);
    return useAsm3 || raw.startsWith('ASM3') || this.isIqcExempt(raw) || this.isPassExempt(raw) || this.isBoxExempt(raw)
      || this.isLockerBackupExempt(raw) || this.isPalletCode(raw);
  }

  private allowedFor(materialCode: string, factory: string): { locations: string[]; source: 'catalog' | 'storageMap' | '' } {
    if (factory !== 'ASM1') return { locations: [], source: '' };
    if (this.ready) {
      const mapShelves = this.kkCatalog.shelvesOnStorageMap(materialCode);
      if (mapShelves.length) return { locations: mapShelves, source: 'storageMap' };
    }
    if (!this.ready) return { locations: [], source: '' };
    const loc = this.kkCatalog.assignedLocForMaterial(materialCode, this.typeMap, this.homeLocs);
    const locations = String(loc || '')
      .split(/[\n\r,;]+/)
      .map((s) => s.trim())
      .filter((s) => {
        const u = s.toUpperCase();
        return !!s && u !== 'PASS' && u !== 'BACKUP' && !u.startsWith('PASS ') && !u.startsWith('BACKUP ');
      });
    return { locations, source: locations.length ? 'catalog' : '' };
  }

  /** R1 / R01 → R01, S7 → S07; Fridge / Frigde coi như nhau. */
  private normalizeCatalogLoc(loc: string): string {
    let s = this.compact(loc);
    s = s.replace(/^([RS])0*(\d{1,2})(?!\d)/, (_m, l: string, n: string) => `${l}${n.padStart(2, '0')}`);
    if (s.startsWith('FRIDGE')) s = 'FRIGDE' + s.slice(6);
    return s;
  }

  /** Kệ R01: mọi mã được để; mã có vị trí R06 được để R05. */
  private isShelfException(target: string, allowed: string[]): boolean {
    const t = this.normalizeCatalogLoc(target);
    const onShelf = (shelf: string) => t === shelf || t.startsWith(shelf + '-');
    if (onShelf('R01')) return true;
    if (onShelf('R05') && allowed.some((a) => /^R06(?!\d)/.test(this.normalizeCatalogLoc(a)))) return true;
    return false;
  }

  private matchesCatalog(target: string, allowed: string[]): boolean {
    if (this.isIqcExempt(target) || this.isBoxExempt(target) || this.isLockerBackupExempt(target)) return true;
    if (this.isShelfException(target, allowed)) return true;
    const t = this.normalizeCatalogLoc(target);
    if (!t) return false;
    for (const loc of allowed) {
      let key = this.normalizeCatalogLoc(loc);
      if (!key) continue;
      const tier = /^([RS]\d{2})-T\d+$/.exec(key);
      if (tier) key = tier[1];
      if (t === key || t.startsWith(key + '-')) return true;
      if (!/^[RS]\d{2}/.test(key) && t.startsWith(key)) return true;
    }
    return false;
  }

  passes(materialCode: string, target: string, factory: string, useAsm3: boolean): boolean {
    if (this.isExempt(target, useAsm3)) return true;
    const r = this.allowedFor(materialCode, factory);
    if (!r.locations.length) return true;
    return this.matchesCatalog(target, r.locations);
  }

  violationMessage(materialCode: string, target: string, factory: string): string {
    const r = this.allowedFor(materialCode, factory);
    const ruleLine = r.source === 'storageMap' ? 'Rule: Sơ đồ lưu trữ (J-Warehouse)' : 'Rule: Danh mục vị trí';
    return `⚠️ Sai rule vị trí\n\nMã hàng: ${materialCode || '(không rõ mã)'}\nVị trí scan: ${target || '(trống)'}\n\n` +
      `${ruleLine}\nChỉ được cất tại: ${r.locations.join(', ') || '(không có vị trí được phép)'}`;
  }
}
