import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { PxkBuildService, PxkLine, PxkWorkOrder } from '../../services/pxk-build.service';
import { Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

@Component({
  selector: 'app-pxk-preview',
  templateUrl: './pxk-preview.component.html',
  styleUrls: ['./pxk-preview.component.scss']
})
export class PxkPreviewComponent implements OnInit, OnDestroy, AfterViewInit {

  @ViewChild('lsxInput') lsxInputRef!: ElementRef<HTMLInputElement>;

  lsx = '';
  pxkHtml: SafeHtml = '';
  isLoading = false;
  errorMsg = '';
  private subs = new Subscription();

  constructor(
    private route: ActivatedRoute,
    private firestore: AngularFirestore,
    private pxkBuild: PxkBuildService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe(q => {
      const qLsx = (q['lsx'] || '').trim();
      if (qLsx) {
        this.lsx = qLsx;
        this.rebuild();
      }
    });
    this.subs.add(
      this.firestore.collection('pxk-import-data').valueChanges().pipe(
        debounceTime(300)
      ).subscribe(() => this.rebuild(true))
    );
    this.subs.add(
      this.firestore.collection('outbound-materials').valueChanges().pipe(
        debounceTime(300)
      ).subscribe(() => this.rebuild(true))
    );
    this.subs.add(
      this.firestore.collection('rm1-delivery-records').valueChanges().pipe(
        debounceTime(300)
      ).subscribe(() => this.rebuild(true))
    );
    this.subs.add(
      this.firestore.collection('inventory-materials').valueChanges().pipe(
        debounceTime(300)
      ).subscribe(() => this.rebuild(true))
    );
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.lsxInputRef?.nativeElement?.focus(), 100);
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  applyLsx(): void {
    this.rebuild();
  }

  async rebuild(backgroundSync = false): Promise<void> {
    const lsx = this.lsx.trim();
    if (!lsx) {
      this.pxkHtml = this.sanitizer.bypassSecurityTrustHtml('');
      this.errorMsg = '';
      return;
    }
    if (!backgroundSync) {
      this.isLoading = true;
      this.errorMsg = '';
    }
    try {
      const pxkDataByLsx = await this.loadPxkData();
      const lines = this.getLinesForLsx(pxkDataByLsx, lsx);
      if (lines.length === 0) {
        if (!backgroundSync) {
          this.pxkHtml = this.sanitizer.bypassSecurityTrustHtml('');
          this.errorMsg = 'Chưa có dữ liệu PXK cho LSX này. Vui lòng import file PXK trước.';
        }
        return;
      }
      const factory = this.detectFactory(lsx);
      const isAsm1 = factory.includes('ASM1') || factory === 'ASM1';
      const factoryFilter = isAsm1 ? 'ASM1' : 'ASM2';
      const [workOrder, locationMap, scanResult, deliveryQtyMap, deliveryNames, nvlBox] = await Promise.all([
        this.loadWorkOrder(lsx, factoryFilter),
        this.loadLocationMap(isAsm1),
        this.loadScanQtyAndEmployees(lsx, factoryFilter),
        this.loadDeliveryData(lsx),
        this.loadDeliveryNames(lsx),
        this.loadNvlSxKsBox(lsx, lines, factoryFilter)
      ]);
      const [scanQtyMap, nhanVienSoanStr] = scanResult;
      const lineNhanFromWo = (workOrder?.productionLine || '').trim();
      const lineNhanFromLines = lines.map(l => String((l as any).lineNhan || '').trim()).find(v => v);
      const lineNhanFromDelivery = (deliveryNames[2] || '').trim(); // lineNhan từ rm1-delivery-records
      const lineNhanOverride = lineNhanFromWo || lineNhanFromDelivery || lineNhanFromLines || undefined;
      const wo: PxkWorkOrder = {
        productionOrder: lsx,
        productCode: workOrder?.productCode || '-',
        quantity: workOrder?.quantity || 0,
        deliveryDate: workOrder?.deliveryDate || null,
        productionLine: lineNhanOverride || workOrder?.productionLine || '-',
        customer: workOrder?.customer || '-'
      };
      const [giaoStr, nhanStr] = deliveryNames;
      const params = {
        lsx,
        lines,
        workOrder: wo,
        factory: factoryFilter,
        scanQtyMap,
        deliveryQtyMap,
        locationMap,
        nhanVienSoanStr,
        nhanVienGiaoStr: giaoStr || '-',
        nhanVienNhanStr: nhanStr || '-',
        lineNhanOverride,
        nvlSxKsBoxHtml: nvlBox
      };
      const html = await this.pxkBuild.buildHtml(params);
      this.pxkHtml = this.sanitizer.bypassSecurityTrustHtml(html);
    } catch (e) {
      if (!backgroundSync) {
        this.errorMsg = 'Lỗi: ' + (e && (e as Error).message ? (e as Error).message : 'Vui lòng thử lại.');
        this.pxkHtml = this.sanitizer.bypassSecurityTrustHtml('');
      }
    } finally {
      if (!backgroundSync) {
        this.isLoading = false;
      }
    }
  }

  private async loadPxkData(): Promise<Record<string, PxkLine[]>> {
    const snap = await this.firestore.collection('pxk-import-data').get().toPromise();
    const out: Record<string, PxkLine[]> = {};
    (snap?.docs || []).forEach((d: any) => {
      const data = d.data();
      const lsx = String(data?.lsx || '').trim();
      const lines = Array.isArray(data?.lines) ? data.lines : [];
      if (lsx && lines.length > 0) out[lsx] = lines;
    });
    return out;
  }

  private getLinesForLsx(byLsx: Record<string, PxkLine[]>, woLsx: string): PxkLine[] {
    const norm = (s: string) => String(s || '').trim().toUpperCase().replace(/\s/g, '').replace(/[-.]/g, '/');
    const woNorm = norm(woLsx);
    const woNum = woNorm.match(/(\d{4}[\/]\d+)/)?.[1] || '';
    const samePrefix = (a: string, b: string) => {
      const pa = a.startsWith('KZ') ? 'KZ' : a.startsWith('LH') ? 'LH' : '';
      const pb = b.startsWith('KZ') ? 'KZ' : b.startsWith('LH') ? 'LH' : '';
      return pa === pb;
    };
    for (const key of Object.keys(byLsx)) {
      if (key.toUpperCase() === woLsx.toUpperCase()) return byLsx[key] || [];
      if (samePrefix(woLsx, key) && norm(key) === woNorm) return byLsx[key] || [];
      const keyNorm = norm(key);
      const keyNum = keyNorm.match(/(\d{4}[\/]\d+)/)?.[1] || '';
      if (woNum && keyNum === woNum && samePrefix(woLsx, key)) return byLsx[key] || [];
    }
    return [];
  }

  private detectFactory(lsx: string): string {
    const u = lsx.toUpperCase();
    if (u.startsWith('KZ')) return 'ASM1';
    if (u.startsWith('LH')) return 'ASM2';
    return 'ASM1';
  }

  private async loadWorkOrder(lsx: string, factory: string): Promise<any> {
    const norm = (s: string) => String(s || '').trim().toUpperCase().replace(/\s/g, '').replace(/[-_.]/g, '/');
    const extractNum = (s: string) => (s || '').match(/(\d{4}[\/\-\.]\d{2,6})/)?.[1]?.replace(/[-.]/g, '/') || '';
    const woNorm = norm(lsx);
    const lsxNum = extractNum(lsx);
    const lsxUpper = lsx.trim().toUpperCase();
    const match = (data: any): boolean => {
      const po = String(data?.productionOrder || '').trim();
      const poUpper = po.toUpperCase();
      if (poUpper === lsxUpper) return true;
      if (norm(po) === woNorm) return true;
      const samePrefix = (lsxUpper.startsWith('KZ') && poUpper.startsWith('KZ')) || (lsxUpper.startsWith('LH') && poUpper.startsWith('LH'));
      if (lsxNum && extractNum(po) === lsxNum && samePrefix) return true;
      if (poUpper.includes(lsxUpper) || lsxUpper.includes(poUpper)) return true;
      return false;
    };
    // Thử tìm trực tiếp bằng field productionOrder (chính xác)
    const directSnap = await this.firestore.collection('work-orders', ref =>
      ref.where('productionOrder', '==', lsx).limit(5)
    ).get().toPromise();
    for (const d of directSnap?.docs || []) {
      const data = d.data() as any;
      if (match(data)) return data;
    }
    // Fallback: load theo factory (tăng limit lên 2000)
    const snap = await this.firestore.collection('work-orders', ref =>
      ref.where('factory', '==', factory).limit(2000)
    ).get().toPromise();
    for (const d of snap?.docs || []) {
      const data = d.data() as any;
      if (match(data)) return data;
    }
    // Fallback cuối: không lọc factory
    const allSnap = await this.firestore.collection('work-orders', ref =>
      ref.limit(3000)
    ).get().toPromise();
    for (const d of allSnap?.docs || []) {
      const data = d.data() as any;
      if (match(data)) return data;
    }
    return null;
  }

  private async loadLocationMap(isAsm1: boolean): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const snap = await this.firestore.collection('inventory-materials', ref =>
      ref.where('factory', '==', isAsm1 ? 'ASM1' : 'ASM2')
    ).get().toPromise();
    (snap?.docs || []).forEach((d: any) => {
      const data = d.data();
      const mat = String(data?.materialCode || '').trim();
      const po = String(data?.poNumber || data?.po || '').trim();
      const loc = String(data?.location || '').trim();
      if (mat && po) map.set(`${mat}|${po}`, loc);
    });
    return map;
  }

  private async loadScanQtyAndEmployees(lsx: string, factory: string): Promise<[Map<string, number>, string]> {
    const map = new Map<string, number>();
    const employeeIds = new Set<string>();
    const norm = (s: string) => {
      const t = String(s || '').trim().toUpperCase().replace(/\s/g, '');
      const m = t.match(/(\d{4}[\/\-\.]\d+)/);
      return m ? m[1].replace(/[-.]/g, '/') : t;
    };
    const woNorm = norm(lsx);
    const snap = await this.firestore.collection('outbound-materials', ref =>
      ref.where('factory', '==', factory)
    ).get().toPromise();
    (snap?.docs || []).forEach((d: any) => {
      const data = d.data();
      const poNorm = norm(data?.productionOrder || '');
      if (!woNorm || poNorm !== woNorm) return;
      const empId = String(data?.employeeId || data?.exportedBy || '').trim();
      if (empId) employeeIds.add(empId.length > 7 ? empId.substring(0, 7) : empId);
      const mat = String(data?.materialCode || '').trim();
      const po = String(data?.poNumber || data?.po || '').trim();
      const qty = Number(data?.exportQuantity || 0);
      if (mat && po) map.set(`${mat}|${po}`, (map.get(`${mat}|${po}`) || 0) + qty);
    });
    const nhanVienSoanStr = employeeIds.size > 0 ? [...employeeIds].filter(Boolean).join(', ') : '-';
    return [map, nhanVienSoanStr];
  }

  private async loadDeliveryData(lsx: string): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const snap = await this.firestore.collection('rm1-delivery-records', ref =>
      ref.where('lsx', '==', lsx)
    ).get().toPromise();
    let doc: any = null;
    if (snap && !snap.empty) doc = snap.docs[0].data();
    else {
      const all = await this.firestore.collection('rm1-delivery-records').get().toPromise();
      const n = (lsx || '').trim().toUpperCase();
      for (const d of all?.docs || []) {
        const data = d.data() as any;
        if ((data?.lsx || '').trim().toUpperCase() === n) { doc = data; break; }
      }
    }
    if (doc && Array.isArray(doc.pxkLines)) {
      doc.pxkLines.forEach((l: any) => {
        const mat = String(l.materialCode || '').trim().toUpperCase();
        const po = String(l.poNumber || l.po || '').trim();
        const qty = Number(l.checkQuantity ?? 0);
        if (mat && po) map.set(`${mat}|${po}`, (map.get(`${mat}|${po}`) || 0) + qty);
      });
    }
    return map;
  }

  private async loadDeliveryNames(lsx: string): Promise<[string, string, string]> {
    const snap = await this.firestore.collection('rm1-delivery-records', ref =>
      ref.where('lsx', '==', lsx)
    ).get().toPromise();
    let doc: any = null;
    if (snap && !snap.empty) doc = snap.docs[0].data();
    else {
      const all = await this.firestore.collection('rm1-delivery-records').get().toPromise();
      const n = (lsx || '').trim().toUpperCase();
      for (const d of all?.docs || []) {
        const data = d.data() as any;
        if ((data?.lsx || '').trim().toUpperCase() === n) { doc = data; break; }
      }
    }
    const giao = (doc?.employeeName || doc?.employeeId || '').trim();
    const nhan = (doc?.receiverEmployeeName || doc?.receiverEmployeeId || '').trim();
    const lineNhan = (doc?.lineNhan || '').trim();
    return [giao || '-', nhan || '-', lineNhan];
  }

  private esc(s: string): string {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  private async loadNvlSxKsBox(lsx: string, lines: PxkLine[], factoryFilter: string): Promise<string> {
    const nvlSxKsLines = lines.filter(l => ['NVL_SX', 'NVL_KS'].includes(String((l as any).maKho || '').trim().toUpperCase()));
    if (nvlSxKsLines.length === 0) return '';
    const normLsxForCompare = (s: string) => String(s || '').trim().toUpperCase().replace(/\s/g, '');
    const currentLsxNorm = normLsxForCompare(lsx);
    const matPotoLsxMap = new Map<string, { lsx: string; importedAt: number }>();
    const lsxToLineMap = new Map<string, string>();
    try {
      const pxkSnap = await this.firestore.collection('pxk-import-data', ref =>
        ref.where('factory', '==', factoryFilter)
      ).get().toPromise();
      (pxkSnap?.docs || []).forEach((docSnap: any) => {
        const d = docSnap.data();
        const docLsx = String(d?.lsx || '').trim();
        if (normLsxForCompare(docLsx) === currentLsxNorm) return;
        const impAt = d?.importedAt?.toMillis?.() ?? d?.importedAt?.getTime?.() ?? 0;
        (Array.isArray(d?.lines) ? d.lines : []).forEach((ln: any) => {
          const mk = String(ln.maKho || '').trim().toUpperCase();
          if (mk !== 'NVL_SX' && mk !== 'NVL_KS') return;
          const mat = String(ln.materialCode || '').trim();
          const po = String(ln.po || ln.poNumber || '').trim();
          const key = `${mat}|${po}`;
          const cur = matPotoLsxMap.get(key);
          if (!cur || impAt > cur.importedAt) matPotoLsxMap.set(key, { lsx: docLsx, importedAt: impAt });
        });
      });
      const lsxSet = new Set([...matPotoLsxMap.values()].map(v => normLsxForCompare(v.lsx)));
      if (lsxSet.size > 0) {
        const woSnap = await this.firestore.collection('work-orders', ref =>
          ref.where('factory', '==', factoryFilter).limit(500)
        ).get().toPromise();
        (woSnap?.docs || []).forEach((docSnap: any) => {
          const wo = docSnap.data() as any;
          const woLsx = String(wo?.productionOrder || '').trim();
          if (lsxSet.has(normLsxForCompare(woLsx))) {
            const line = String(wo?.productionLine || '').trim();
            if (line) lsxToLineMap.set(normLsxForCompare(woLsx), line);
          }
        });
      }
    } catch (e) {
      console.warn('loadNvlSxKsBox error:', e);
    }
    const nvlRows = nvlSxKsLines
      .sort((a, b) => (a.materialCode || '').localeCompare(b.materialCode || ''))
      .map((l, i) => {
        const key = `${String(l.materialCode || '').trim()}|${String(l.po || '').trim()}`;
        const info = matPotoLsxMap.get(key);
        const lsxVal = info?.lsx || '-';
        const lineVal = info ? lsxToLineMap.get(normLsxForCompare(info.lsx)) || '' : '';
        return `<tr>
          <td style="border:1px solid #000;padding:6px;text-align:center;">${i + 1}</td>
          <td style="border:1px solid #000;padding:6px;">${this.esc(l.materialCode)}</td>
          <td style="border:1px solid #000;padding:6px;">${this.esc(l.po)}</td>
          <td style="border:1px solid #000;padding:6px;">${this.esc(String((l as any).maKho || '').trim())}</td>
          <td style="border:1px solid #000;padding:6px;">${this.esc(lsxVal)}</td>
          <td style="border:1px solid #000;padding:6px;">${this.esc(lineVal)}</td>
        </tr>`;
      }).join('');
    return `
<div style="margin-top:16px;">
  <div style="font-weight:bold;margin-bottom:6px;font-size:10px;">Kho NVL_SX / NVL_KS được sử dụng gần nhất</div>
  <table style="width:100%;border-collapse:collapse;margin-top:4px;font-size:10px;">
    <thead><tr>
      <th style="border:1px solid #000;padding:6px;background:#f0f0f0;">STT</th>
      <th style="border:1px solid #000;padding:6px;background:#f0f0f0;">Mã vật tư</th>
      <th style="border:1px solid #000;padding:6px;background:#f0f0f0;">PO</th>
      <th style="border:1px solid #000;padding:6px;background:#f0f0f0;">Mã Kho</th>
      <th style="border:1px solid #000;padding:6px;background:#f0f0f0;">LSX</th>
      <th style="border:1px solid #000;padding:6px;background:#f0f0f0;">Line</th>
    </tr></thead>
    <tbody>${nvlRows}</tbody>
  </table>
</div>`;
  }
}
