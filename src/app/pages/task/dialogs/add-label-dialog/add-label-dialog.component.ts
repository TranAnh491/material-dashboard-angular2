import { Component, Inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { TaskLabel } from '../../../../models/task.model';

@Component({
  selector: 'app-add-label-dialog',
  template: `
    <h2 mat-dialog-title>Add Label</h2>
    <mat-dialog-content>
      <mat-form-field>
        <input matInput placeholder="Label name" [(ngModel)]="label.name">
      </mat-form-field>
      <mat-form-field>
        <input matInput type="color" placeholder="Label color" [(ngModel)]="label.color">
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button (click)="onCancel()">Cancel</button>
      <button mat-raised-button color="primary" (click)="onAdd()">Add</button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
  `]
})
export class AddLabelDialogComponent {
  label: TaskLabel = {
    id: Date.now().toString(),
    name: '',
    color: '#4caf50'
  };

  constructor(
    public dialogRef: MatDialogRef<AddLabelDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { existingLabels: TaskLabel[] }
  ) {}

  onCancel(): void {
    this.dialogRef.close();
  }

  onAdd(): void {
    if (this.label.name.trim()) {
      this.dialogRef.close(this.label);
    }
  }
} 