import { Component, OnInit, OnDestroy, Inject, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { QRScannerService, QRScanResult } from '../../services/qr-scanner.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

export interface QRScannerData {
  title: string;
  message?: string;
  materialCode?: string;
}

@Component({
  selector: 'app-qr-scanner-modal',
  templateUrl: './qr-scanner-modal.component.html',
  styleUrls: ['./qr-scanner-modal.component.scss']
})
export class QRScannerModalComponent implements OnInit, OnDestroy, AfterViewInit {
  private destroy$ = new Subject<void>();
  
  @ViewChild('videoPreviewContainer') videoPreviewContainerRef!: ElementRef;
  
  scannerState: 'idle' | 'starting' | 'scanning' | 'error' = 'idle';
  videoElement: HTMLVideoElement | null = null;
  errorMessage: string = '';
  isScanning = false;
  
  constructor(
    public dialogRef: MatDialogRef<QRScannerModalComponent>,
    @Inject(MAT_DIALOG_DATA) public data: QRScannerData,
    private qrScannerService: QRScannerService
  ) {}

  ngOnInit(): void {
    console.log('🎬 Barcode Scanner Modal opened');
    this.checkCameraSupport();
    this.subscribeScannerState();
  }

  ngAfterViewInit(): void {
    console.log('🎬 QR Scanner Modal AfterViewInit - DOM ready');
    console.log('🎯 ViewChild element:', this.videoPreviewContainerRef);
    console.log('🎯 Native element:', this.videoPreviewContainerRef?.nativeElement);
    
    // Auto-start scanning after DOM is ready with longer delay
    setTimeout(() => {
      console.log('🎯 After delay - ViewChild element:', this.videoPreviewContainerRef);
      console.log('🎯 After delay - Native element:', this.videoPreviewContainerRef?.nativeElement);
      this.startScanning();
    }, 1000);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.stopScanning();
    console.log('🚪 QR Scanner Modal closed');
  }

  /**
   * Check if camera is supported
   */
  checkCameraSupport(): void {
    if (!this.qrScannerService.isCameraSupported()) {
      this.errorMessage = 'Camera không được hỗ trợ trên thiết bị này';
      this.scannerState = 'error';
    }
  }

  /**
   * Subscribe to scanner state changes
   */
  subscribeScannerState(): void {
    this.qrScannerService.scannerState$
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.scannerState = state;
        console.log('📷 Scanner state:', state);
      });
  }

  /**
   * Start barcode scanning
   */
  async startScanning(): Promise<void> {
    try {
      this.isScanning = true;
      this.errorMessage = '';
      
      console.log('🚀 Starting barcode scan...');
      console.log('🎯 Video container element:', this.videoPreviewContainerRef?.nativeElement);
      
      // Fallback: if ViewChild is not available, try to find element by ID
      let videoContainer = this.videoPreviewContainerRef?.nativeElement;
      if (!videoContainer) {
        console.log('🎯 ViewChild not available, trying to find by ID...');
        videoContainer = document.getElementById('video-preview-container');
        console.log('🎯 Found by ID:', videoContainer);
        
        // If still not found, try to find by class
        if (!videoContainer) {
          console.log('🎯 Not found by ID, trying to find by class...');
          videoContainer = document.querySelector('.video-preview') as HTMLElement;
          console.log('🎯 Found by class:', videoContainer);
        }
      }
      
      const scanResult$ = await this.qrScannerService.startScanning({
        facingMode: 'environment' // Use back camera
      }, videoContainer);

      // Listen for scan results
      scanResult$.pipe(takeUntil(this.destroy$)).subscribe({
        next: (result: QRScanResult) => {
          console.log('✅ Barcode scan successful:', result);
          this.onScanSuccess(result);
        },
        error: (error) => {
          console.error('❌ Barcode scan error:', error);
          this.onScanError(error);
        },
        complete: () => {
          console.log('🏁 Barcode scan completed');
        }
      });

    } catch (error) {
      console.error('❌ Failed to start scanning:', error);
      this.onScanError(error);
    }
  }

  /**
   * Stop scanning
   */
  stopScanning(): void {
    this.isScanning = false;
    this.qrScannerService.stopScanning();
    this.videoElement = null;
  }

  /**
   * Setup video preview in modal
   */
  setupVideoPreview(): void {
    try {
      const videoContainer = document.getElementById('video-preview-container');
      if (videoContainer && this.qrScannerService.getCurrentState() === 'scanning') {
        this.videoElement = this.qrScannerService.createVideoPreview();
        
        // Style the video element
        this.videoElement.style.width = '100%';
        this.videoElement.style.height = 'auto';
        this.videoElement.style.borderRadius = '8px';
        
        // Clear container and add video
        videoContainer.innerHTML = '';
        videoContainer.appendChild(this.videoElement);
        
        console.log('📺 Video preview setup complete');
      }
    } catch (error) {
      console.error('❌ Error setting up video preview:', error);
    }
  }

  /**
   * Handle successful QR scan
   */
  onScanSuccess(result: QRScanResult): void {
    console.log('🎯 QR scan result:', result.text);
    
    // DON'T close modal automatically - let the parent component decide
    // Just emit the result to the parent component
    this.dialogRef.close({
      success: true,
      text: result.text,
      location: result.text,
      timestamp: result.timestamp
    });
  }

  /**
   * Handle scan error
   */
  onScanError(error: any): void {
    this.errorMessage = error.message || 'Lỗi khi quét QR code';
    this.scannerState = 'error';
    this.isScanning = false;
  }

  /**
   * Retry scanning
   */
  retryScanning(): void {
    this.errorMessage = '';
    this.startScanning();
  }

  /**
   * Close modal without result
   */
  closeModal(): void {
    this.dialogRef.close({
      success: false,
      cancelled: true
    });
  }

  /**
   * Manual input fallback
   */
  openManualInput(): void {
    const manualLocation = prompt('Nhập vị trí thủ công:');
    if (manualLocation && manualLocation.trim()) {
      this.dialogRef.close({
        success: true,
        location: manualLocation.trim(),
        timestamp: new Date(),
        manual: true
      });
    }
  }

}
