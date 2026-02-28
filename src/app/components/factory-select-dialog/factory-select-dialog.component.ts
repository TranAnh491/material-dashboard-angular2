import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';

@Component({
  selector: 'app-factory-select-dialog',
  template: `
    <div class="factory-dialog">
      <div class="dialog-header">
        <i class="material-icons">factory</i>
        <h2>Chọn nhà máy</h2>
      </div>
      <div class="dialog-content">
        <p>Vui lòng chọn nhà máy để tải LSX từ Work Order</p>
        <div class="factory-buttons">
          <button class="factory-btn asm1" (click)="select('ASM1')">
            <i class="material-icons">business</i>
            <span>ASM1</span>
            <small>LSX: KZLSX</small>
          </button>
          <button class="factory-btn asm2" (click)="select('ASM2')">
            <i class="material-icons">business</i>
            <span>ASM2</span>
            <small>LSX: LHLSX</small>
          </button>
        </div>
      </div>
      <div class="dialog-actions">
        <button class="cancel-btn" (click)="onCancel()">
          <i class="material-icons">close</i>
          Hủy
        </button>
      </div>
    </div>
  `,
  styles: [`
    .factory-dialog {
      width: 340px;
      max-width: 95vw;
      padding: 0;
    }
    .dialog-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 20px 20px 8px;
    }
    .dialog-header .material-icons {
      font-size: 32px;
      width: 32px;
      height: 32px;
      color: #3b82f6;
    }
    .dialog-header h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      color: #0f172a;
    }
    .dialog-content {
      padding: 12px 20px 16px;
    }
    .dialog-content p {
      margin: 0 0 16px 0;
      color: #64748b;
      font-size: 14px;
    }
    .factory-buttons {
      display: flex;
      gap: 12px;
    }
    .factory-btn {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 16px 12px;
      border: 2px solid #e2e8f0;
      border-radius: 10px;
      background: #fff;
      cursor: pointer;
      transition: all 0.2s;
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
    }
    .factory-btn .material-icons {
      font-size: 28px;
      color: #64748b;
    }
    .factory-btn small {
      font-size: 11px;
      font-weight: 500;
      color: #94a3b8;
    }
    .factory-btn:hover {
      border-color: #3b82f6;
      background: #eff6ff;
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.15);
    }
    .factory-btn.asm1:hover .material-icons { color: #2563eb; }
    .factory-btn.asm2:hover .material-icons { color: #0891b2; }
    .dialog-actions {
      padding: 0 20px 20px;
      display: flex;
      justify-content: center;
    }
    .cancel-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #fff;
      color: #64748b;
      font-size: 14px;
      cursor: pointer;
    }
    .cancel-btn:hover {
      background: #f1f5f9;
      color: #475569;
    }
    .cancel-btn .material-icons { font-size: 18px; }
  `]
})
export class FactorySelectDialogComponent {
  constructor(public dialogRef: MatDialogRef<FactorySelectDialogComponent>) {}

  select(factory: 'ASM1' | 'ASM2'): void {
    this.dialogRef.close(factory);
  }

  onCancel(): void {
    this.dialogRef.close(null);
  }
}
