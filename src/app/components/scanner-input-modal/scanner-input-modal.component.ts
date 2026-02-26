import { Component, Inject, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

export interface ScannerInputData {
  title: string;
  message?: string;
}

@Component({
  selector: 'app-scanner-input-modal',
  templateUrl: './scanner-input-modal.component.html',
  styleUrls: ['./scanner-input-modal.component.scss']
})
export class ScannerInputModalComponent implements AfterViewInit {
  @ViewChild('scanInput') scanInputRef!: ElementRef;

  scanValue: string = '';

  constructor(
    public dialogRef: MatDialogRef<ScannerInputModalComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ScannerInputData
  ) {}

  ngAfterViewInit(): void {
    setTimeout(() => {
      if (this.scanInputRef?.nativeElement) {
        this.scanInputRef.nativeElement.focus();
      }
    }, 150);
  }

  onConfirm(): void {
    const value = this.scanValue.trim();
    if (!value) return;
    this.dialogRef.close({ success: true, text: value });
  }

  closeModal(): void {
    this.dialogRef.close({ success: false, cancelled: true });
  }
}
