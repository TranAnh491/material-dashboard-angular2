import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { BrowserMultiFormatReader, Result } from '@zxing/library';

export interface QRScanResult {
  text: string;
  format?: string;
  timestamp: Date;
}

export interface ScannerOptions {
  facingMode?: 'user' | 'environment';
  width?: number;
  height?: number;
}

@Injectable({
  providedIn: 'root'
})
export class QRScannerService {
  private codeReader: BrowserMultiFormatReader;
  private videoElement: HTMLVideoElement | null = null;
  private isScanning = false;
  private currentDeviceId: string | undefined;

  // Scanner state
  private scannerStateSubject = new BehaviorSubject<'idle' | 'starting' | 'scanning' | 'error'>('idle');
  public scannerState$ = this.scannerStateSubject.asObservable();

  constructor() {
    this.codeReader = new BrowserMultiFormatReader();
    console.log('📱 Barcode Scanner Service initialized with ZXing MultiFormat');
  }

  /**
   * Start camera and barcode scanning
   */
  async startScanning(options: ScannerOptions = {}): Promise<Observable<QRScanResult>> {
    try {
      console.log('📱 Starting barcode scanner...');
      this.scannerStateSubject.next('starting');

      // Get back camera if available
      const videoInputDevices = await this.codeReader.getVideoInputDevices();
      console.log('📷 Available cameras:', videoInputDevices.length);
      
      // Try to find back camera first
      let selectedDeviceId = videoInputDevices[0]?.deviceId;
      for (const device of videoInputDevices) {
        if (device.label.toLowerCase().includes('back') || 
            device.label.toLowerCase().includes('rear') ||
            device.label.toLowerCase().includes('environment')) {
          selectedDeviceId = device.deviceId;
          break;
        }
      }

      this.currentDeviceId = selectedDeviceId;
      this.isScanning = true;
      this.scannerStateSubject.next('scanning');

      // Create scan result observable
      return new Observable<QRScanResult>(observer => {
        this.startBarcodeDecoding(observer, selectedDeviceId);
      });

    } catch (error) {
      console.error('❌ Error starting barcode scanner:', error);
      this.scannerStateSubject.next('error');
      throw new Error('Không thể truy cập camera: ' + error.message);
    }
  }

  /**
   * Stop scanning and cleanup
   */
  stopScanning(): void {
    console.log('🛑 Stopping barcode scanner...');
    
    this.isScanning = false;
    
    // Reset the code reader
    this.codeReader.reset();

    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }

    this.currentDeviceId = undefined;
    this.scannerStateSubject.next('idle');
    
    console.log('✅ Barcode scanner stopped and cleaned up');
  }

  /**
   * Check if browser supports camera
   */
  isCameraSupported(): boolean {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /**
   * Get available cameras
   */
  async getAvailableCameras(): Promise<MediaDeviceInfo[]> {
    try {
      return await this.codeReader.getVideoInputDevices();
    } catch (error) {
      console.error('❌ Error getting cameras:', error);
      return [];
    }
  }

  /**
   * Start barcode decoding with ZXing
   */
  private startBarcodeDecoding(observer: any, deviceId: string | undefined): void {
    // Create video element
    this.videoElement = document.createElement('video');
    this.videoElement.style.width = '100%';
    this.videoElement.style.height = 'auto';
    
    // Start decoding from video input device
    this.codeReader.decodeFromVideoDevice(deviceId, this.videoElement, (result: Result | null, error: any) => {
      if (result) {
        console.log('🎯 Barcode detected:', result.getText());
        console.log('📊 Barcode format:', result.getBarcodeFormat());
        
        // Emit successful result
        observer.next({
          text: result.getText(),
          format: result.getBarcodeFormat()?.toString(),
          timestamp: new Date()
        });
        
        // Auto-stop scanning after successful decode
        this.stopScanning();
        observer.complete();
        
      } else if (error && error.name !== 'NotFoundException') {
        // Only log non-standard errors (NotFoundException is normal when no barcode is visible)
        console.warn('⚠️ Barcode scan error:', error);
      }
    }).catch((error) => {
      console.error('❌ Failed to start barcode decoding:', error);
      this.scannerStateSubject.next('error');
      observer.error(error);
    });
  }

  /**
   * Create video preview element for UI
   */
  createVideoPreview(): HTMLVideoElement {
    if (!this.videoElement) {
      throw new Error('No active video stream');
    }
    return this.videoElement;
  }

  /**
   * Get current scanner state
   */
  getCurrentState(): 'idle' | 'starting' | 'scanning' | 'error' {
    return this.scannerStateSubject.value;
  }
}
