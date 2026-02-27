import { Component, OnInit, OnDestroy, Inject, ViewChild, ElementRef } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

export type DeliveryScanStep = 'nvGiao' | 'nvNhan' | 'lsx' | 'lineNhan' | 'checkHang';

export interface PxkLineRow {
  materialCode: string;
  poNumber: string;
  quantity: number;
  checkQuantity?: number;
}

export interface DeliveryScanFlowResult {
  success: boolean;
  cancelled?: boolean;
  employeeGiaoId?: string;
  employeeGiaoName?: string;
  employeeNhanId?: string;
  employeeNhanName?: string;
  lsx?: string;
  lineNhan?: string;
  pxkLines?: PxkLineRow[];
}

@Component({
  selector: 'app-delivery-scan-flow-modal',
  templateUrl: './delivery-scan-flow-modal.component.html',
  styleUrls: ['./delivery-scan-flow-modal.component.scss']
})
export class DeliveryScanFlowModalComponent implements OnInit, OnDestroy {
  @ViewChild('scanInput') scanInputRef!: ElementRef;

  currentStep: DeliveryScanStep = 'nvGiao';
  scanValue = '';
  errorMessage = '';

  nvGiaoId = '';
  nvGiaoName = '';
  nvNhanId = '';
  nvNhanName = '';
  lsx = '';
  lineNhan = '';
  pxkRows: PxkLineRow[] = [];
  isLoadingPxk = false;

  private destroy$ = new Subject<void>();

  readonly stepLabels: Record<DeliveryScanStep, string> = {
    nvGiao: 'Quét mã Nhân viên Giao',
    nvNhan: 'Quét mã Nhân viên Nhận',
    lsx: 'Quét mã Lệnh Sản Xuất (LSX)',
    lineNhan: 'Quét mã Line nhận',
    checkHang: 'Quét mã hàng  (Mã hàng | PO | Số lượng)'
  };

  constructor(
    public dialogRef: MatDialogRef<DeliveryScanFlowModalComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { title?: string },
    private firestore: AngularFirestore
  ) {}

  ngOnInit(): void {
    // Focus input ngay sau khi dialog animation hoàn tất
    this.dialogRef.afterOpened()
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.focusInput());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get stepLabel(): string {
    return this.stepLabels[this.currentStep];
  }

  get lineHasScanned(): boolean {
    return this.pxkRows.some(r => (r.checkQuantity ?? 0) > 0);
  }

  get isCheckHangStep(): boolean {
    return this.currentStep === 'checkHang';
  }

  private focusInput(): void {
    // Dùng requestAnimationFrame để đảm bảo DOM đã render xong
    requestAnimationFrame(() => {
      this.scanInputRef?.nativeElement?.focus();
    });
  }

  /** Lấy 7 ký tự đầu, kiểm tra định dạng ASP + 4 chữ số */
  private extractEmployeeId(raw: string): { valid: boolean; id: string; error?: string } {
    const id = raw.trim().substring(0, 7).toUpperCase();
    if (/^ASP\d{4}$/.test(id)) {
      return { valid: true, id };
    }
    return {
      valid: false,
      id,
      error: `Mã không hợp lệ "${id}" — Cần định dạng ASP + 4 số (VD: ASP0001)`
    };
  }

  onScan(): void {
    const raw = this.scanValue.trim();
    if (!raw) return;
    this.errorMessage = '';

    switch (this.currentStep) {
      case 'nvGiao': {
        const r = this.extractEmployeeId(raw);
        if (!r.valid) { this.setError(r.error!); return; }
        this.nvGiaoId = r.id;
        this.nvGiaoName = r.id;
        this.scanValue = '';
        this.currentStep = 'nvNhan';
        this.focusInput();
        this.lookupName(r.id, 'nvGiao');
        break;
      }
      case 'nvNhan': {
        const r = this.extractEmployeeId(raw);
        if (!r.valid) { this.setError(r.error!); return; }
        this.nvNhanId = r.id;
        this.nvNhanName = r.id;
        this.scanValue = '';
        this.currentStep = 'lsx';
        this.focusInput();
        this.lookupName(r.id, 'nvNhan');
        break;
      }
      case 'lsx': {
        this.lsx = raw;
        this.scanValue = '';
        this.currentStep = 'lineNhan';
        this.loadPxk();
        this.focusInput();
        break;
      }
      case 'lineNhan': {
        this.lineNhan = raw;
        this.scanValue = '';
        this.currentStep = 'checkHang';
        this.focusInput();
        break;
      }
      case 'checkHang': {
        this.scanLine(raw);
        break;
      }
    }
  }

  private setError(msg: string): void {
    this.errorMessage = msg;
    this.scanValue = '';
    this.focusInput();
  }

  private lookupName(id: string, target: 'nvGiao' | 'nvNhan'): void {
    this.firestore.collection('users', ref => ref.where('displayName', '==', id).limit(1))
      .get().toPromise()
      .then(snap => {
        if (snap && !snap.empty) {
          const name = (snap.docs[0].data() as any).displayName || id;
          if (target === 'nvGiao') this.nvGiaoName = name;
          else this.nvNhanName = name;
        }
      }).catch(() => {});
  }

  private normLsx(s: string): string {
    const t = String(s || '').trim().toUpperCase().replace(/\s/g, '');
    const m = t.match(/(\d{4}[\/\-\.]\d+)/);
    return m ? m[1].replace(/[-.]/g, '/') : t;
  }

  private loadPxk(): void {
    if (!this.lsx) return;
    this.isLoadingPxk = true;
    this.pxkRows = [];
    const target = this.normLsx(this.lsx);

    const TOP_MA_KHO = new Set(['NVL', 'NVL_E31', 'NVL_KE31', 'NVL_EXPIRED', '00']);
    this.firestore.collection('pxk-import-data').get().toPromise().then(snap => {
      const rows: PxkLineRow[] = [];
      (snap?.docs || []).forEach(doc => {
        const d = doc.data() as any;
        if (this.normLsx(String(d?.lsx || '')) !== target) return;
        (Array.isArray(d?.lines) ? d.lines : []).forEach((ln: any) => {
          const code = String(ln.materialCode || '').trim().toUpperCase();
          if (!code) return;
          // Chỉ hiển thị mã ở nhóm kho NVL, NVL_E31, NVL_KE31, NVL_EXPIRED, 00
          const maKho = String(ln.maKho || '').trim().toUpperCase();
          if (!TOP_MA_KHO.has(maKho)) return;
          // Ẩn mã R và mã bắt đầu B033, B030
          if (code.charAt(0) === 'R') return;
          if (code.startsWith('B033')) return;
          if (code.startsWith('B030')) return;
          rows.push({
            materialCode: code,
            poNumber: String(ln.po || ln.poNumber || '').trim(),
            quantity: Number(ln.quantity) || 0
          });
        });
      });
      this.pxkRows = rows.sort((a, b) =>
        (a.materialCode + a.poNumber).localeCompare(b.materialCode + b.poNumber)
      );
      this.isLoadingPxk = false;
    }).catch(() => { this.isLoadingPxk = false; });
  }

  private scanLine(raw: string): void {
    const parts = raw.split('|').map(p => p.trim());
    const code = (parts[0] || '').toUpperCase();
    const po = (parts[1] || '').toUpperCase();
    const qty = parts.length >= 3 ? (parseFloat(parts[2]) || 0) : 0;

    if (!code) { this.scanValue = ''; this.focusInput(); return; }

    const row = this.pxkRows.find(r =>
      r.materialCode.toUpperCase() === code && r.poNumber.toUpperCase() === po
    );

    if (!row) {
      this.setError(`Không tìm thấy "${code}${po ? '/' + po : ''}" trong danh sách PXK`);
      return;
    }

    // Cộng dồn: mỗi lần scan thêm qty (hoặc +1 nếu không có qty) vào số lượng hiện tại
    row.checkQuantity = (row.checkQuantity ?? 0) + (qty > 0 ? qty : 1);
    this.errorMessage = '';
    this.scanValue = '';
    this.focusInput();
  }

  onDone(): void {
    this.dialogRef.close({
      success: true,
      employeeGiaoId: this.nvGiaoId,
      employeeGiaoName: this.nvGiaoName,
      employeeNhanId: this.nvNhanId,
      employeeNhanName: this.nvNhanName,
      lsx: this.lsx,
      lineNhan: this.lineNhan,
      pxkLines: this.pxkRows
    } as DeliveryScanFlowResult);
  }

  closeModal(): void {
    this.dialogRef.close({ success: false, cancelled: true } as DeliveryScanFlowResult);
  }
}
