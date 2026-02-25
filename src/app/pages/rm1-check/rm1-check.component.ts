import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';

interface PxkImportDoc {
  lsx: string;
  factory: string;
  lines: PxkLine[];
  importedAt: any;
}

interface PxkLine {
  materialCode: string;
  quantity: number;
  unit: string;
  po: string;
}

interface CheckRow {
  stt: number;
  materialCode: string;
  po: string;
  unit: string;
  quantityPxk: number;
  quantityScan: number;
  comparison: 'Đủ' | string;
  quantityDelivery: number;
}

@Component({
  selector: 'app-rm1-check',
  templateUrl: './rm1-check.component.html',
  styleUrls: ['./rm1-check.component.scss']
})
export class Rm1CheckComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  availableLsxList: string[] = [];
  selectedLsx: string = '';
  selectedLsxInModal: string = '';
  showLsxModal = false;
  checkRows: CheckRow[] = [];
  isLoadingLsx = false;
  isLoadingCheck = false;
  hasAccess = false;

  constructor(
    private firestore: AngularFirestore,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    console.log('📋 RM1 Check Component initialized');
    this.loadAvailableLsx();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  get rowsThieu(): CheckRow[] {
    return this.checkRows.filter(r => r.comparison.startsWith('Thiếu'));
  }

  openLsxModal(): void {
    this.selectedLsxInModal = this.selectedLsx;
    this.showLsxModal = true;
  }

  closeLsxModal(): void {
    this.showLsxModal = false;
  }

  async confirmLsxSelection(): Promise<void> {
    if (!this.selectedLsxInModal) return;
    this.selectedLsx = this.selectedLsxInModal;
    this.showLsxModal = false;
    await this.onLsxSelected();
  }

  async loadAvailableLsx(): Promise<void> {
    this.isLoadingLsx = true;
    try {
      const snapshot = await this.firestore.collection('pxk-import-data', ref =>
        ref.where('factory', '==', 'ASM1').limit(500)
      ).get().toPromise();
      const lsxSet = new Set<string>();
      snapshot?.docs?.forEach(doc => {
        const data = doc.data() as PxkImportDoc;
        if (data.lsx && data.factory === 'ASM1') {
          lsxSet.add(String(data.lsx).trim());
        }
      });
      this.availableLsxList = Array.from(lsxSet).sort((a, b) => a.localeCompare(b));
    } catch (e) {
      console.error('RM1 Check: load LSX error', e);
    } finally {
      this.isLoadingLsx = false;
      this.cdr.markForCheck();
    }
  }

  async onLsxSelected(): Promise<void> {
    if (!this.selectedLsx) {
      this.checkRows = [];
      this.cdr.markForCheck();
      return;
    }
    this.isLoadingCheck = true;
    this.checkRows = [];
    this.cdr.markForCheck();
    try {
      const lsxNorm = String(this.selectedLsx).trim();
      const docId = `ASM1_${lsxNorm.replace(/\//g, '_').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const pxkDoc = await this.firestore.collection('pxk-import-data').doc(docId).get().toPromise();
      const pxkLines: PxkLine[] = [];
      if (pxkDoc?.exists) {
        const d = pxkDoc.data() as PxkImportDoc;
        if (d?.lines) {
          pxkLines.push(...d.lines);
        }
      }
      if (pxkLines.length === 0) {
        this.cdr.markForCheck();
        this.isLoadingCheck = false;
        return;
      }
      const lsxUpper = lsxNorm.toUpperCase();
      // Query trực tiếp theo productionOrder (LSX) để lấy đủ dữ liệu, không bị limit cắt
      const outboundSnapshot = await this.firestore.collection('outbound-materials', ref =>
        ref.where('factory', '==', 'ASM1')
           .where('productionOrder', '==', lsxNorm)
           .limit(1000)
      ).get().toPromise();
      const scanMap = new Map<string, number>();
      outboundSnapshot?.docs?.forEach(doc => {
        const d = doc.data() as { productionOrder?: string; materialCode?: string; poNumber?: string; exportQuantity?: number };
        const prodOrder = (d.productionOrder || '').trim().toUpperCase();
        if (prodOrder !== lsxUpper) return;
        const materialCode = String(d.materialCode || '').trim();
        const prefix = materialCode.toUpperCase().charAt(0);
        if (prefix !== 'B') return; // Chỉ tính mã bắt đầu bằng B, không tính mã R
        const po = String(d.poNumber ?? '').trim();
        const qty = Number(d.exportQuantity) || 0;
        const key = `${materialCode}|${po}`;
        scanMap.set(key, (scanMap.get(key) || 0) + qty);
      });
      // Fallback: nếu query exact không trả về dữ liệu, thử load tất cả ASM1 rồi filter theo LSX (includes)
      if (scanMap.size === 0) {
        const fallbackSnapshot = await this.firestore.collection('outbound-materials', ref =>
          ref.where('factory', '==', 'ASM1').limit(5000)
        ).get().toPromise();
        fallbackSnapshot?.docs?.forEach(doc => {
          const d = doc.data() as { productionOrder?: string; materialCode?: string; poNumber?: string; exportQuantity?: number };
          const prodOrderRaw = (d.productionOrder || '').trim();
          const prodOrder = prodOrderRaw.toUpperCase();
          if (!prodOrder || (prodOrder !== lsxUpper && !prodOrder.includes(lsxUpper) && !lsxUpper.includes(prodOrder))) return;
          const materialCode = String(d.materialCode || '').trim();
          const prefix = materialCode.toUpperCase().charAt(0);
          if (prefix !== 'B') return; // Chỉ tính mã bắt đầu bằng B, không tính mã R
          const po = String(d.poNumber ?? '').trim();
          const qty = Number(d.exportQuantity) || 0;
          const key = `${materialCode}|${po}`;
          scanMap.set(key, (scanMap.get(key) || 0) + qty);
        });
      }
      // Load Giao hàng từ rm1-delivery-records (mode = giao-hang)
      const deliveryMap = new Map<string, number>();
      const deliverySnapshot = await this.firestore.collection('rm1-delivery-records', ref =>
        ref.where('lsx', '==', lsxNorm)
           .where('mode', '==', 'giao-hang')
           .limit(100)
      ).get().toPromise();
      deliverySnapshot?.docs?.forEach(doc => {
        const data = doc.data() as { outboundLines?: Array<{ materialCode?: string; poNumber?: string; deliveryQuantity?: number }> };
        (data.outboundLines || []).forEach((line: any) => {
          const matCode = String(line.materialCode || '').trim();
          const prefix = matCode.toUpperCase().charAt(0);
          if (prefix !== 'B') return;
          const po = String(line.poNumber ?? '').trim();
          const qty = Number(line.deliveryQuantity ?? line.quantity ?? 0) || 0;
          const key = `${matCode}|${po}`;
          deliveryMap.set(key, (deliveryMap.get(key) || 0) + qty);
        });
      });
      const rows: CheckRow[] = [];
      let stt = 0;
      pxkLines.forEach((line) => {
        const matCode = (line.materialCode || '').trim();
        const prefix = matCode.toUpperCase().charAt(0);
        if (prefix === 'R') return; // Không hiển thị mã R
        stt++;
        const key = `${matCode}|${(line.po || '').trim()}`;
        const qtyPxk = Number(line.quantity) || 0;
        const qtyScan = scanMap.get(key) || 0;
        const qtyDelivery = deliveryMap.get(key) || 0;
        const diff = qtyPxk - qtyScan;
        const diffStr = Number.isInteger(diff) ? String(diff) : parseFloat(diff.toFixed(4)).toString();
        const comparison = diff <= 0 ? 'Đủ' : `Thiếu ${diffStr}`;
        rows.push({
          stt,
          materialCode: line.materialCode || '',
          po: line.po || '',
          unit: line.unit || '',
          quantityPxk: qtyPxk,
          quantityScan: qtyScan,
          comparison,
          quantityDelivery: qtyDelivery
        });
      });
      this.checkRows = rows;
    } catch (e) {
      console.error('RM1 Check: load check error', e);
    } finally {
      this.isLoadingCheck = false;
      this.cdr.markForCheck();
    }
  }
}
