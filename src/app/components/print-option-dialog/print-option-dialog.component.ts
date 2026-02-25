import { Component, Inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { WorkOrder } from '../../models/material-lifecycle.model';

export type PrintOption = 'qr' | 'pxk';

export interface PrintOptionDialogData {
  workOrder: WorkOrder;
}

@Component({
  selector: 'app-print-option-dialog',
  template: `
    <h2 mat-dialog-title>Chọn loại in</h2>
    <mat-dialog-content>
      <p style="margin-bottom:16px;color:#666;">LSX: {{ data.workOrder?.productionOrder }}</p>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <button mat-stroked-button (click)="select('qr')" style="justify-content:flex-start;">
          <mat-icon>qr_code_2</mat-icon>
          <span>In QR code</span>
        </button>
        <button mat-stroked-button (click)="select('pxk')" style="justify-content:flex-start;">
          <mat-icon>description</mat-icon>
          <span>In PXK (Production Order Material List)</span>
        </button>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Hủy</button>
    </mat-dialog-actions>
  `,
  styles: [`
    button[mat-stroked-button] {
      height: 48px;
      mat-icon { margin-right: 12px; }
    }
  `]
})
export class PrintOptionDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<PrintOptionDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PrintOptionDialogData
  ) {}

  select(option: PrintOption): void {
    this.dialogRef.close(option);
  }
}
