import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ImportProgress } from '../../services/excel-import.service';

@Component({
  selector: 'app-import-progress-dialog',
  templateUrl: './import-progress-dialog.component.html',
  styleUrls: ['./import-progress-dialog.component.scss']
})
export class ImportProgressDialogComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  
  progress: ImportProgress = {
    current: 0,
    total: 0,
    message: 'Đang chuẩn bị...',
    status: 'processing'
  };

  constructor(
    public dialogRef: MatDialogRef<ImportProgressDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { progress$: any }
  ) {}

  ngOnInit(): void {
    if (this.data?.progress$) {
      this.data.progress$
        .pipe(takeUntil(this.destroy$))
        .subscribe((progress: ImportProgress) => {
          this.progress = progress;
          
          // Auto-close on completion or error
          if (progress.status === 'completed' || progress.status === 'error') {
            setTimeout(() => {
              this.dialogRef.close({
                status: progress.status,
                message: progress.message
              });
            }, 2000);
          }
        });
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  getProgressPercentage(): number {
    if (this.progress.total === 0) return 0;
    return (this.progress.current / this.progress.total) * 100;
  }

  getProgressColor(): string {
    switch (this.progress.status) {
      case 'processing':
        return '#2196F3';
      case 'completed':
        return '#4CAF50';
      case 'error':
        return '#F44336';
      default:
        return '#2196F3';
    }
  }

  getStatusIcon(): string {
    switch (this.progress.status) {
      case 'processing':
        return 'hourglass_empty';
      case 'completed':
        return 'check_circle';
      case 'error':
        return 'error';
      default:
        return 'hourglass_empty';
    }
  }

  onCancel(): void {
    this.dialogRef.close({ status: 'cancelled' });
  }
}
