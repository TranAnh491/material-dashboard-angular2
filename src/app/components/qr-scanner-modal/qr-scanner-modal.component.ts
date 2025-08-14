import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
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
export class QRScannerModalComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  
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
    
    // Auto-start scanning immediately
    setTimeout(() => {
      this.startScanning();
    }, 500);
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
      
      const scanResult$ = await this.qrScannerService.startScanning({
        facingMode: 'environment' // Use back camera
      });

      // Setup video preview
      setTimeout(() => {
        this.setupVideoPreview();
      }, 1000);

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
    
    // Close modal and return result
    this.dialogRef.close({
      success: true,
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
