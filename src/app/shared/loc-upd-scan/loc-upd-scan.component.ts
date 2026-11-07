import { appAlert } from '../app-toast';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import firebase from 'firebase/compat/app';
import { KkHistoryLogService } from '../../services/kk-history-log.service';
import { LocationScanRulesService } from '../../services/location-scan-rules.service';

/** 1 dòng tồn (mã + PO + IMD) trong phiên quét. */
export interface LocUpdLine {
  id: string;
  materialCode: string;
  poNumber: string;
  imd: string;
  batchNumber: string;
  unit: string;
  quantity: number;
  stock: number;
  fromLocation: string;
  wasKk: boolean;
  scannedQty: number;
  scans: number;
  /** 1 tem = đúng toàn bộ tồn → đã xác nhận là tem thùng. */
  cartonConfirmed: boolean;
}

export interface LocUpdDoneEvent {
  location: string;
  operator: string;
  lines: LocUpdLine[];
}

/** Nhật ký mỗi lần DONE — đọc ở Report cập nhật vị trí (tab Location). */
export const LOC_UPD_SESSIONS = 'location-update-sessions';

/**
 * Màn hình scan dùng chung:
 * - tab Location: "Cập nhật vị trí"
 * - tab Quản lý NVL: "Kiểm kê"
 * Bước 1 scan vị trí → bước 2 scan hết tem mã ở vị trí đó → DONE: lưu vị trí mới + lượng quét; đủ lượng tự tick KK.
 */
@Component({
  selector: 'app-loc-upd-scan',
  templateUrl: './loc-upd-scan.component.html',
  styleUrls: ['./loc-upd-scan.component.scss']
})
export class LocUpdScanComponent implements OnInit {
  @Input() factory = '';
  /** Mã nhân viên đang thao tác; trống → hỏi ở bước đầu. */
  @Input() operatorId = '';
  @Input() title = 'Cập nhật vị trí';
  /** Ghi vào nhật ký để biết phiên đến từ tab nào. */
  @Input() source: 'location' | 'kiem-ke' = 'location';
  @Output() closed = new EventEmitter<void>();
  @Output() done = new EventEmitter<LocUpdDoneEvent>();

  step: 'operator' | 'loc' | 'items' = 'loc';
  operatorInput = '';
  location = '';
  useAsm3 = false;
  locInput = '';
  itemInput = '';
  lines: LocUpdLine[] = [];
  private scans: Array<{ lineId: string; qty: number }> = [];
  log: Array<{ ok: boolean; text: string; at: Date }> = [];
  busy = false;
  saving = false;
  private stockCache = new Map<string, LocUpdLine[]>();

  constructor(
    private firestore: AngularFirestore,
    private auth: AngularFireAuth,
    private kkLog: KkHistoryLogService,
    private rules: LocationScanRulesService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    void this.rules.load();
    this.operatorId = String(this.operatorId || '').trim().toUpperCase();
    this.step = this.operatorId ? 'loc' : 'operator';
    this.focus(this.step === 'operator' ? 'locUpdOperatorInput' : 'locUpdLocInput');
  }

  get stepText(): string {
    if (this.step === 'operator') return 'Bước 0 · Scan / nhập mã nhân viên';
    return this.step === 'loc' ? 'Bước 1 · Scan vị trí' : 'Bước 2 · Scan tất cả mã ở vị trí';
  }

  private focus(id: string): void {
    setTimeout(() => (document.getElementById(id) as HTMLInputElement | null)?.focus(), 80);
  }

  close(): void {
    if (this.saving) return;
    if (this.scans.length && !confirm('Chưa bấm DONE — bỏ toàn bộ lượt quét vừa rồi?')) return;
    this.closed.emit();
  }

  /** Bước 0: mã nhân viên (ASPxxxx). */
  onOperatorScan(): void {
    const raw = String(this.operatorInput || '').trim().toUpperCase();
    this.operatorInput = '';
    const m = /ASP\d{4}/.exec(raw);
    if (!m) {
      appAlert('⚠️ Mã nhân viên phải dạng ASP + 4 số (VD: ASP0106).');
      this.focus('locUpdOperatorInput');
      return;
    }
    this.operatorId = m[0];
    this.step = 'loc';
    this.cdr.detectChanges();
    this.focus('locUpdLocInput');
  }

  /** Bước 1: scan vị trí. */
  onLocScan(): void {
    let raw = String(this.locInput || '').trim();
    if (raw.includes('|')) raw = raw.split('|')[0].trim();
    this.locInput = '';
    if (!raw) return;
    const useAsm3 = raw.replace(/\s/g, '').toUpperCase().startsWith('ASM3');
    const loc = this.rules.normalizeTarget(raw, useAsm3);
    if (!loc || (!this.rules.isExempt(loc, useAsm3) && !this.rules.validate(loc))) {
      appAlert(`⚠️ Vị trí không hợp lệ: ${raw}`);
      this.focus('locUpdLocInput');
      return;
    }
    this.location = loc;
    this.useAsm3 = useAsm3;
    this.step = 'items';
    this.cdr.detectChanges();
    this.focus('locUpdItemInput');
  }

  /** Quét lại vị trí khác — bỏ các lượt quét mã hiện tại. */
  changeLocation(): void {
    if (this.scans.length && !confirm('Đổi vị trí sẽ bỏ các lượt quét mã hiện tại. Tiếp tục?')) return;
    this.resetScans();
    this.step = 'loc';
    this.location = '';
    this.cdr.detectChanges();
    this.focus('locUpdLocInput');
  }

  private resetScans(): void {
    this.lines = [];
    this.scans = [];
    this.log = [];
    this.itemInput = '';
    this.stockCache = new Map();
  }

  /** Bước 2: rời ô scan (chạm ra ngoài) → tự đặt lại con trỏ để scan tiếp. */
  keepFocus(): void {
    setTimeout(() => {
      if (this.step !== 'items' || this.saving) return;
      const el = document.getElementById('locUpdItemInput') as HTMLInputElement | null;
      if (el && document.activeElement !== el) el.focus();
    }, 200);
  }

  private pushLog(ok: boolean, text: string): void {
    this.log = [{ ok, text, at: new Date() }, ...this.log].slice(0, 60);
  }

  private parseImportDate(v: unknown): Date | null {
    if (!v) return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    if (typeof v === 'object' && v !== null && 'toDate' in v) {
      try { const d = (v as { toDate: () => Date }).toDate(); return Number.isNaN(d.getTime()) ? null : d; } catch { return null; }
    }
    if (typeof v === 'object' && v !== null && 'seconds' in v) {
      const d = new Date(Number((v as { seconds: number }).seconds) * 1000);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof v === 'string') {
      const t = v.trim();
      if (/^\d{8,10}$/.test(t)) {
        const d = new Date(parseInt(t.substring(4, 8), 10), parseInt(t.substring(2, 4), 10) - 1, parseInt(t.substring(0, 2), 10));
        return Number.isNaN(d.getTime()) ? null : d;
      }
      const parts = t.split(/[/-]/);
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
        return Number.isNaN(d.getTime()) ? null : d;
      }
      const d = new Date(t);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof v === 'number') { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
    return null;
  }

  /** IMD của dòng tồn — cùng logic tab Location (batchNumber 10 số). */
  private imdKeyOf(data: Record<string, unknown>): string {
    const batchNumber = String(data?.['batchNumber'] ?? '').trim();
    const rawImport = String(data?.['importDate'] ?? '').trim();
    if (/^\d{10}$/.test(rawImport)) return rawImport;
    if (/^\d{10}$/.test(batchNumber)) return batchNumber;
    const importDate = this.parseImportDate(data?.['importDate']);
    const baseDate = importDate
      ? importDate.toLocaleDateString('en-GB').split('/').join('')
      : (/^\d{8}$/.test(rawImport) ? rawImport : '');
    if (!baseDate) {
      const m = /^(\d{8,10})/.exec(batchNumber);
      return m?.[1] || '';
    }
    if (batchNumber && batchNumber !== baseDate) {
      if (/^\d{10}$/.test(batchNumber) && batchNumber.startsWith(baseDate)) return batchNumber;
      if (batchNumber.startsWith(baseDate)) {
        const suffix = batchNumber.substring(baseDate.length);
        if (/^\d{1,2}$/.test(suffix)) return baseDate + suffix;
      }
      const m = /^(\d{8,10})/.exec(batchNumber);
      if (m) return m[1];
    }
    return baseDate;
  }

  private imdMatch(scanned: string, inv: string): boolean {
    if (!scanned) return true;
    if (!inv) return false;
    return scanned === inv || scanned.startsWith(inv) || inv.startsWith(scanned);
  }

  private poMatch(invPo: string, scannedPo: string): boolean {
    const a = (invPo || '').trim();
    const b = (scannedPo || '').trim();
    if (!b) return true;
    return a === b || a.replace(/\s+/g, '') === b.replace(/\s+/g, '');
  }

  private async loadStock(code: string): Promise<LocUpdLine[]> {
    const cached = this.stockCache.get(code);
    if (cached) return cached;
    const snap = await this.firestore.firestore
      .collection('inventory-materials')
      .where('factory', '==', this.factory)
      .where('materialCode', '==', code)
      .limit(80)
      .get();
    const rows: LocUpdLine[] = [];
    snap.forEach((doc) => {
      const d = doc.data() as Record<string, unknown>;
      const opening = d['openingStock'] !== null && d['openingStock'] !== undefined ? Number(d['openingStock']) || 0 : 0;
      const stock = Math.round((opening + (Number(d['quantity']) || 0) - (Number(d['exported']) || 0) - (Number(d['xt']) || 0)) * 10000) / 10000;
      if (!(stock > 0)) return;
      rows.push({
        id: doc.id,
        materialCode: String(d['materialCode'] || code).trim().toUpperCase(),
        poNumber: String(d['poNumber'] || '').trim(),
        imd: this.imdKeyOf(d),
        batchNumber: String(d['batchNumber'] || '').trim(),
        unit: String(d['unit'] || '').trim(),
        quantity: Number(d['quantity']) || 0,
        stock,
        fromLocation: String(d['location'] ?? d['viTri'] ?? '').trim().toUpperCase(),
        wasKk: d['kkChecked'] === true,
        scannedQty: 0,
        scans: 0,
        cartonConfirmed: false
      });
    });
    this.stockCache.set(code, rows);
    return rows;
  }

  /** Bước 2: scan từng tem mã hàng (Mã|PO|Lượng|IMD). */
  async onItemScan(): Promise<void> {
    const raw = String(this.itemInput || '').trim();
    this.itemInput = '';
    if (!raw || this.busy) return;
    const parts = raw.split('|').map((p) => p.trim());
    const code = (parts[0] || '').substring(0, 7).toUpperCase();
    const po = parts[1] || '';
    const qty = Number(String(parts[2] || '').replace(/,/g, ''));
    const p4 = (parts[3] || '').trim();
    const imd = parts.length >= 4 ? (p4.indexOf('-') >= 0 ? p4.slice(0, p4.indexOf('-')).trim() : p4) : '';
    if (!code || parts.length < 3) {
      this.pushLog(false, `${raw} — không phải tem mã hàng (cần Mã|PO|Lượng|IMD)`);
      this.focus('locUpdItemInput');
      return;
    }
    if (!(qty > 0)) {
      this.pushLog(false, `${code} / ${po || '—'} — tem không có lượng`);
      this.focus('locUpdItemInput');
      return;
    }
    this.busy = true;
    try {
      const rows = await this.loadStock(code);
      const matches = rows.filter((r) => this.poMatch(r.poNumber, po) && this.imdMatch(imd, r.imd));
      if (!matches.length) {
        this.pushLog(false, `${code} / ${po || '—'}${imd ? ' / ' + imd : ''} — không có dòng tồn khớp Mã + PO + IMD`);
        return;
      }
      if (!this.rules.passes(code, this.location, this.factory, this.useAsm3)) {
        appAlert(this.rules.violationMessage(code, this.location, this.factory));
        this.pushLog(false, `${code} — sai rule vị trí, không nhận`);
        return;
      }
      // Ưu tiên dòng còn thiếu lượng
      const line = matches.find((r) => r.scannedQty + 1e-9 < r.stock) || matches[0];
      const nextQty = Math.round((line.scannedQty + qty) * 10000) / 10000;
      // 1 tem mà lượng = đúng toàn bộ tồn → thường là tem thùng: hỏi xác nhận, không thì không nhận.
      if (line.scans === 0 && Math.abs(qty - line.stock) < 1e-6) {
        const ok = confirm(
          `Tem này có lượng ${this.fq(qty)} = toàn bộ tồn kho của dòng.\n\n` +
          `Mã: ${code}\nPO: ${line.poNumber || '—'}\nIMD: ${line.imd || '—'}\n\n` +
          `Đây có phải TEM THÙNG không?\n• OK = đúng tem thùng → ghi nhận kiểm kê\n• Cancel = không nhận lần quét này`
        );
        if (!ok) {
          this.pushLog(false, `${code} / ${line.poNumber || '—'} — tem = toàn bộ tồn, không xác nhận tem thùng → không nhận`);
          return;
        }
        line.cartonConfirmed = true;
      }
      line.scannedQty = nextQty;
      line.scans += 1;
      this.scans.push({ lineId: line.id, qty });
      if (!this.lines.includes(line)) this.lines = [line, ...this.lines];
      if (this.isOver(line)) {
        appAlert(
          `⚠️ Lượng quét LỚN HƠN tồn kho\n\n` +
          `Mã: ${code} / PO ${line.poNumber || '—'}\n` +
          `Đã quét: ${this.fq(line.scannedQty)} · Tồn kho: ${this.fq(line.stock)}\n\n` +
          `Vẫn ghi nhận vị trí — cần IN LẠI TEM cho lô này.`
        );
      }
      const tail = this.isOver(line)
        ? ' · THỪA → IN LẠI TEM'
        : this.isEnough(line) ? (line.cartonConfirmed ? ' · TEM THÙNG · ĐỦ' : ' · ĐỦ') : '';
      this.pushLog(true, `${code} / ${line.poNumber || '—'} +${this.fq(qty)} → ${this.fq(line.scannedQty)} / ${this.fq(line.stock)}${tail}`);
    } catch (e) {
      console.error('[LocUpdScan] item scan', e);
      this.pushLog(false, `${code} — lỗi đọc tồn kho, quét lại`);
    } finally {
      this.busy = false;
      this.cdr.detectChanges();
      this.focus('locUpdItemInput');
    }
  }

  undoLast(): void {
    const last = this.scans.pop();
    if (!last) return;
    const line = this.lines.find((l) => l.id === last.lineId);
    if (line) {
      line.scannedQty = Math.max(0, Math.round((line.scannedQty - last.qty) * 10000) / 10000);
      line.scans = Math.max(0, line.scans - 1);
      if (line.scans === 0) {
        line.cartonConfirmed = false;
        this.lines = this.lines.filter((l) => l !== line);
      }
      this.pushLog(true, `Hoàn tác: ${line.materialCode} / ${line.poNumber || '—'} −${this.fq(last.qty)}`);
    }
    this.focus('locUpdItemInput');
  }

  /** Đủ = lượng quét bằng tồn kho (thừa không tính là đủ — phải in lại tem). */
  isEnough(line: LocUpdLine): boolean {
    return Math.abs(line.scannedQty - line.stock) < 1e-6;
  }

  isOver(line: LocUpdLine): boolean {
    return line.scannedQty > line.stock + 1e-6;
  }

  get enoughCount(): number { return this.lines.filter((l) => this.isEnough(l)).length; }
  get overCount(): number { return this.lines.filter((l) => this.isOver(l)).length; }

  fq(n: number): string {
    return (Math.round((Number(n) || 0) * 10000) / 10000).toLocaleString('en-US', { maximumFractionDigits: 4 });
  }

  private async resolveOperator(): Promise<string> {
    if (this.operatorId) return this.operatorId;
    const user = await this.auth.currentUser;
    const email = String(user?.email || '').trim().toUpperCase();
    return /ASP\d{4}/.exec(email)?.[0] || String(user?.displayName || email || 'UNKNOWN').substring(0, 24);
  }

  /** DONE: lưu vị trí mới + lượng quét cho từng dòng (mã + PO + IMD); đủ lượng → tick KK. */
  async finish(): Promise<void> {
    const lines = this.lines.filter((l) => l.scans > 0);
    if (!lines.length || this.saving) return;
    const enough = lines.filter((l) => this.isEnough(l));
    const over = lines.filter((l) => this.isOver(l));
    const short = lines.length - enough.length - over.length;
    if (!confirm(
      `Lưu ${lines.length} dòng vào vị trí ${this.location}?\n\n` +
      `• Đủ lượng (tick KK): ${enough.length}\n` +
      `• Thiếu lượng (ghi lượng đã quét, chưa tick KK): ${short}\n` +
      `• Thừa lượng (ghi vị trí, cần IN LẠI TEM): ${over.length}`
    )) return;
    this.saving = true;
    this.cdr.detectChanges();
    try {
      const operator = await this.resolveOperator();
      const at = new Date();
      const dateKey = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
      const db = this.firestore.firestore;
      const target = this.location;
      for (let i = 0; i < lines.length; i += 120) {
        const batch = db.batch();
        for (const line of lines.slice(i, i + 120)) {
          const tick = this.isEnough(line);
          const payload: Record<string, unknown> = {
            kkReprintNeeded: this.isOver(line),
            kkCartonLabel: line.cartonConfirmed,
            location: target,
            viTri: target,
            kkScanQty: line.scannedQty,
            kkScanCount: line.scans,
            locationScannedAt: at,
            updatedAt: at,
            lastModified: firebase.firestore.FieldValue.serverTimestamp(),
            modifiedBy: operator,
            locationManualOverride: true
          };
          if (tick) {
            payload['kkChecked'] = true;
            payload['kkBy'] = operator;
            payload['kkAt'] = at;
          }
          batch.update(db.collection('inventory-materials').doc(line.id), payload);
          if (line.fromLocation !== target) {
            batch.set(db.collection('material-location-history').doc(), {
              factory: this.factory,
              materialId: line.id,
              materialCode: line.materialCode,
              poNumber: line.poNumber,
              fromLocation: line.fromLocation,
              toLocation: target,
              changedBy: operator,
              changeType: this.source === 'kiem-ke' ? 'kiem-ke-scan' : 'location-update-scan',
              changedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          }
          if (tick) {
            const log = {
              inventoryDocId: line.id,
              factory: this.factory,
              materialCode: line.materialCode,
              materialName: '',
              poNumber: line.poNumber,
              batchNumber: line.batchNumber,
              location: target,
              quantity: line.quantity,
              stock: line.stock,
              unit: line.unit,
              checkedBy: operator,
              checkedAt: at,
              checkedDateKey: dateKey,
              createdAt: new Date(),
              source: this.source === 'kiem-ke' ? 'kiem-ke-scan' : 'location-update-scan'
            };
            batch.set(db.collection('inventory-kk-history').doc(), log);
            this.kkLog.enqueue(log);
          }
        }
        await batch.commit();
      }
      try {
        await this.saveSession(target, operator, at, lines);
      } catch (logErr) {
        console.warn('[LocUpdScan] save session', logErr);
      }
      appAlert(
        `✅ Đã ${this.source === 'kiem-ke' ? 'kiểm kê' : 'cập nhật vị trí'} ${target}\n\n` +
        `• ${lines.length} dòng (mã + PO + IMD)\n` +
        `• Tick KK (đủ lượng): ${enough.length}\n` +
        `• Chưa tick (thiếu lượng): ${short}` +
        (over.length
          ? `\n\n⚠️ Cần IN LẠI TEM (${over.length}):\n` +
            over.map((l) => `• ${l.materialCode} / PO ${l.poNumber || '—'} — quét ${this.fq(l.scannedQty)} > tồn ${this.fq(l.stock)}`).join('\n')
          : '')
      );
      this.scans = [];
      this.done.emit({ location: target, operator, lines });
      this.closed.emit();
    } catch (e) {
      console.error('[LocUpdScan] finish', e);
      appAlert(`❌ Lỗi khi lưu: ${(e as any)?.message || e}`);
    } finally {
      this.saving = false;
      this.cdr.detectChanges();
    }
  }

  /** Ghi 1 phiên DONE: kệ nào, ai quét, mã gì, mấy thùng — để xem Report. */
  private async saveSession(target: string, operator: string, at: Date, lines: LocUpdLine[]): Promise<void> {
    const status = (l: LocUpdLine) => (this.isOver(l) ? 'Thừa' : this.isEnough(l) ? 'Đủ' : 'Thiếu');
    await this.firestore.firestore.collection(LOC_UPD_SESSIONS).add({
      factory: this.factory,
      location: target,
      operator,
      at,
      source: this.source,
      lineCount: lines.length,
      boxCount: lines.reduce((n, l) => n + l.scans, 0),
      lines: lines.map((l) => ({
        inventoryId: l.id,
        materialCode: l.materialCode,
        poNumber: l.poNumber,
        imd: l.imd,
        fromLocation: l.fromLocation,
        boxes: l.scans,
        scannedQty: l.scannedQty,
        stock: l.stock,
        status: status(l),
        cartonLabel: l.cartonConfirmed,
        kkTicked: this.isEnough(l)
      }))
    });
  }
}
