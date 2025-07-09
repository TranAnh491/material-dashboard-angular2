import { Component, Inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { TaskAssignee } from '../../../../models/task.model';

@Component({
  selector: 'app-add-assignee-dialog',
  template: `
    <h2 mat-dialog-title>Add Assignee</h2>
    <mat-dialog-content>
      <mat-form-field>
        <input matInput placeholder="Assignee name" [(ngModel)]="assignee.name">
      </mat-form-field>
      <mat-form-field>
        <input matInput placeholder="Avatar URL (optional)" [(ngModel)]="assignee.avatar">
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
export class AddAssigneeDialogComponent {
  assignee: TaskAssignee = {
    id: '',
    name: '',
    avatar: 'assets/img/faces/marc.jpg',
    email: ''
  };

  constructor(
    public dialogRef: MatDialogRef<AddAssigneeDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { currentAssignees: TaskAssignee[] }
  ) {}

  onCancel(): void {
    this.dialogRef.close();
  }

  onAdd(): void {
    if (this.assignee.name.trim()) {
      this.dialogRef.close(this.assignee);
    }
  }
} 