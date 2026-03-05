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
      ).subscribe(() => this.rebuild())
    );
    this.subs.add(
      this.firestore.collection('outbound-materials').valueChanges().pipe(
        debounceTime(300)
      ).subscribe(() => this.rebuild())
    );
    this.subs.add(
      this.firestore.collection('rm1-delivery-records').valueChanges().pipe(
        debounceTime(300)
      ).subscribe(() => this.rebuild())
    );
    this.subs.add(
      this.firestore.collection('inventory-materials').valueChanges().pipe(
        debounceTime(300)
      ).subscribe(() => this.rebuild())
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

  async rebuild(): Promise<void> {
    const lsx = this.lsx.trim();
    if (!lsx) {
      this.pxkHtml = this.sanitizer.bypassSecurityTrustHtml('');
      this.errorMsg = '';
      return;
    }
    this.isLoading = true;
    this.errorMsg = '';
    try {
      const pxkDataByLsx = await this.loadPxkData();
      const lines = this.getLinesForLsx(pxkDataByLsx, lsx);
      if (lines.length === 0) {
        this.pxkHtml = this.sanitizer.bypassSecurityTrustHtml('');
        this.errorMsg = 'Chưa có dữ liệu PXK cho LSX này. Vui lòng import file PXK trước.';
        this.isLoading = false;
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
        Promise.resolve('')
      ]);
      const [scanQtyMap, nhanVienSoanStr] = scanResult;
      const wo: PxkWorkOrder = {
        productionOrder: lsx,
        productCode: workOrder?.productCode || '-',
        quantity: workOrder?.quantity || 0,
        deliveryDate: workOrder?.deliveryDate || null,
        productionLine: workOrder?.productionLine || '-',
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
        nvlSxKsBoxHtml: nvlBox
      };
      const html = await this.pxkBuild.buildHtml(params);
      this.pxkHtml = this.sanitizer.bypassSecurityTrustHtml(html);
    } catch (e) {
      this.errorMsg = 'Lỗi: ' + (e && (e as Error).message ? (e as Error).message : 'Vui lòng thử lại.');
      this.pxkHtml = this.sanitizer.bypassSecurityTrustHtml('');
    } finally {
      this.isLoading = false;
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
    let snap = await this.firestore.collection('work-orders', ref =>
      ref.where('factory', '==', factory).limit(200)
    ).get().toPromise();
    const norm = (s: string) => String(s || '').trim().toUpperCase().replace(/\s/g, '').replace(/[-_.]/g, '/');
    const woNorm = norm(lsx);
    for (const d of snap?.docs || []) {
      const data = d.data() as any;
      const po = String(data?.productionOrder || '').trim();
      if (po.toUpperCase() === lsx.toUpperCase() || norm(po) === woNorm) return data;
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

  private async loadDeliveryNames(lsx: string): Promise<[string, string]> {
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
    return [giao || '-', nhan || '-'];
  }
}
