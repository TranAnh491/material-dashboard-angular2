import { Component, OnInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

interface CapturedImage {
  dataUrl: string;
  timestamp: Date;
  type: 'sample' | 'printed';
  name: string;
}

interface PrintSchedule {
  id: string;
  labelType: string;
  quantity: number;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'printing' | 'completed' | 'failed';
  requestedBy: string;
  requestDate: Date;
  dueDate: Date;
  progress: number;
}

@Component({
  selector: 'app-print-label',
  templateUrl: './print-label.component.html',
  styleUrls: ['./print-label.component.scss']
})
export class PrintLabelComponent implements OnInit, OnDestroy {
  @ViewChild('videoElement', { static: false }) videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasElement', { static: false }) canvasElement!: ElementRef<HTMLCanvasElement>;

  // Active tab management
  activeTab: 'schedules' | 'check' = 'schedules';

  // Print Schedules properties
  printSchedules: PrintSchedule[] = [];
  filteredSchedules: PrintSchedule[] = [];
  searchTerm = '';
  statusFilter = 'all';
  priorityFilter = 'all';

  // Check Label properties (từ CheckLabelComponent)
  isCameraActive = false;
  mediaStream: MediaStream | null = null;
  capturedImages: CapturedImage[] = [];
  currentCaptureMode: 'sample' | 'printed' = 'sample';
  
  // UI state
  isLoading = false;
  showComparison = false;
  selectedSampleImage: CapturedImage | null = null;
  selectedPrintedImage: CapturedImage | null = null;
  
  // Comparison results
  comparisonResults = {
    sizeMatch: false,
    fontMatch: false,
    textSizeMatch: false,
    overallMatch: false,
    confidence: 0
  };

  constructor(private snackBar: MatSnackBar) {}

  ngOnInit(): void {
    this.loadMockPrintSchedules();
    this.filterSchedules();
  }

  ngOnDestroy(): void {
    this.stopCamera();
  }

  // Tab Management
  switchTab(tab: 'schedules' | 'check'): void {
    this.activeTab = tab;
    if (tab === 'check') {
      // Initialize camera when switching to check tab
      setTimeout(() => this.requestCameraPermission(), 100);
    } else {
      // Stop camera when switching away from check tab
      this.stopCamera();
    }
  }

  // === PRINT SCHEDULES FUNCTIONALITY ===
  
  private loadMockPrintSchedules(): void {
    this.printSchedules = [
      {
        id: 'PS001',
        labelType: 'Product Label - Medium',
        quantity: 1000,
        priority: 'high',
        status: 'printing',
        requestedBy: 'John Smith',
        requestDate: new Date('2024-01-15'),
        dueDate: new Date('2024-01-16'),
        progress: 65
      },
      {
        id: 'PS002',
        labelType: 'Shipping Label - Large',
        quantity: 500,
        priority: 'medium',
        status: 'pending',
        requestedBy: 'Sarah Johnson',
        requestDate: new Date('2024-01-15'),
        dueDate: new Date('2024-01-17'),
        progress: 0
      },
      {
        id: 'PS003',
        labelType: 'Barcode Label - Small',
        quantity: 2000,
        priority: 'low',
        status: 'completed',
        requestedBy: 'Mike Wilson',
        requestDate: new Date('2024-01-14'),
        dueDate: new Date('2024-01-15'),
        progress: 100
      },
      {
        id: 'PS004',
        labelType: 'Warning Label - Medium',
        quantity: 750,
        priority: 'high',
        status: 'failed',
        requestedBy: 'Lisa Davis',
        requestDate: new Date('2024-01-15'),
        dueDate: new Date('2024-01-16'),
        progress: 0
      },
      {
        id: 'PS005',
        labelType: 'QR Code Label - Small',
        quantity: 1500,
        priority: 'medium',
        status: 'pending',
        requestedBy: 'Tom Brown',
        requestDate: new Date('2024-01-15'),
        dueDate: new Date('2024-01-18'),
        progress: 0
      }
    ];
  }

  filterSchedules(): void {
    this.filteredSchedules = this.printSchedules.filter(schedule => {
      const matchesSearch = schedule.labelType.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
                           schedule.requestedBy.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
                           schedule.id.toLowerCase().includes(this.searchTerm.toLowerCase());
      
      const matchesStatus = this.statusFilter === 'all' || schedule.status === this.statusFilter;
      const matchesPriority = this.priorityFilter === 'all' || schedule.priority === this.priorityFilter;
      
      return matchesSearch && matchesStatus && matchesPriority;
    });
  }

  onSearchChange(): void {
    this.filterSchedules();
  }

  onStatusFilterChange(): void {
    this.filterSchedules();
  }

  onPriorityFilterChange(): void {
    this.filterSchedules();
  }

  startPrinting(schedule: PrintSchedule): void {
    schedule.status = 'printing';
    schedule.progress = 0;
    this.simulatePrintProgress(schedule);
    this.showNotification(`Started printing ${schedule.labelType}`, 'success');
  }

  pausePrinting(schedule: PrintSchedule): void {
    schedule.status = 'pending';
    this.showNotification(`Paused printing ${schedule.labelType}`, 'info');
  }

  cancelPrinting(schedule: PrintSchedule): void {
    schedule.status = 'failed';
    schedule.progress = 0;
    this.showNotification(`Cancelled printing ${schedule.labelType}`, 'warning');
  }

  private simulatePrintProgress(schedule: PrintSchedule): void {
    if (schedule.status !== 'printing') return;
    
    const interval = setInterval(() => {
      if (schedule.status !== 'printing') {
        clearInterval(interval);
        return;
      }
      
      schedule.progress += Math.random() * 10;
      if (schedule.progress >= 100) {
        schedule.progress = 100;
        schedule.status = 'completed';
        clearInterval(interval);
        this.showNotification(`Completed printing ${schedule.labelType}`, 'success');
      }
    }, 1000);
  }

  getPriorityColor(priority: string): string {
    switch (priority) {
      case 'high': return '#F44336';
      case 'medium': return '#FF9800';
      case 'low': return '#4CAF50';
      default: return '#757575';
    }
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'completed': return '#4CAF50';
      case 'printing': return '#2196F3';
      case 'pending': return '#FF9800';
      case 'failed': return '#F44336';
      default: return '#757575';
    }
  }

  // === CHECK LABEL FUNCTIONALITY ===
  // (Di chuyển từ CheckLabelComponent)

  async requestCameraPermission(): Promise<void> {
    try {
      this.isLoading = true;
      
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          facingMode: 'environment'
        },
        audio: false
      });
      
      this.isCameraActive = true;
      this.showNotification('Camera ready! Position your label and capture.', 'success');
      
      setTimeout(() => {
        if (this.videoElement && this.videoElement.nativeElement) {
          this.videoElement.nativeElement.srcObject = this.mediaStream;
        }
      }, 100);
      
    } catch (error) {
      console.error('Camera access denied:', error);
      this.showNotification('Camera access required for label checking.', 'error');
    } finally {
      this.isLoading = false;
    }
  }

  startCamera(): void {
    if (!this.isCameraActive) {
      this.requestCameraPermission();
    }
  }

  stopCamera(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    this.isCameraActive = false;
  }

  captureImage(): void {
    if (!this.videoElement || !this.canvasElement) {
      this.showNotification('Camera not ready', 'error');
      return;
    }

    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;
    const context = canvas.getContext('2d')!;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/png');

    const capturedImage: CapturedImage = {
      dataUrl,
      timestamp: new Date(),
      type: this.currentCaptureMode,
      name: `${this.currentCaptureMode === 'sample' ? 'Sample' : 'Printed'} Label ${this.capturedImages.filter(img => img.type === this.currentCaptureMode).length + 1}`
    };

    this.capturedImages.push(capturedImage);

    if (this.currentCaptureMode === 'sample') {
      this.selectedSampleImage = capturedImage;
      this.showNotification('Sample label captured! Now capture the printed label.', 'success');
      this.currentCaptureMode = 'printed';
    } else {
      this.selectedPrintedImage = capturedImage;
      this.showNotification('Printed label captured! Ready for comparison.', 'success');
      this.currentCaptureMode = 'sample';
    }

    if (this.selectedSampleImage && this.selectedPrintedImage) {
      setTimeout(() => this.performComparison(), 500);
    }
  }

  selectImage(image: CapturedImage): void {
    if (image.type === 'sample') {
      this.selectedSampleImage = image;
    } else {
      this.selectedPrintedImage = image;
    }

    if (this.selectedSampleImage && this.selectedPrintedImage) {
      this.performComparison();
    }
  }

  deleteImage(image: CapturedImage): void {
    const index = this.capturedImages.indexOf(image);
    if (index > -1) {
      this.capturedImages.splice(index, 1);
      
      if (this.selectedSampleImage === image) {
        this.selectedSampleImage = null;
      }
      if (this.selectedPrintedImage === image) {
        this.selectedPrintedImage = null;
      }
      
      this.showNotification('Image deleted', 'info');
    }
  }

  performComparison(): void {
    if (!this.selectedSampleImage || !this.selectedPrintedImage) {
      this.showNotification('Please select both sample and printed labels', 'warning');
      return;
    }

    this.isLoading = true;
    this.showComparison = true;

    setTimeout(() => {
      const mockResults = this.generateMockComparisonResults();
      this.comparisonResults = mockResults;
      this.isLoading = false;
      
      const status = mockResults.overallMatch ? 'PASS' : 'FAIL';
      const message = `Comparison complete: ${status} (${mockResults.confidence}% confidence)`;
      this.showNotification(message, mockResults.overallMatch ? 'success' : 'error');
    }, 2000);
  }

  private generateMockComparisonResults() {
    const sizeMatch = Math.random() > 0.2;
    const fontMatch = Math.random() > 0.15;
    const textSizeMatch = Math.random() > 0.1;
    
    const overallMatch = sizeMatch && fontMatch && textSizeMatch;
    const confidence = overallMatch ? 
      Math.floor(85 + Math.random() * 15) :
      Math.floor(45 + Math.random() * 40);

    return {
      sizeMatch,
      fontMatch,
      textSizeMatch,
      overallMatch,
      confidence
    };
  }

  retakeImage(type: 'sample' | 'printed'): void {
    this.currentCaptureMode = type;
    this.showNotification(`Ready to capture ${type} label`, 'info');
  }

  clearAll(): void {
    this.capturedImages = [];
    this.selectedSampleImage = null;
    this.selectedPrintedImage = null;
    this.showComparison = false;
    this.currentCaptureMode = 'sample';
    this.showNotification('All images cleared', 'info');
  }

  downloadComparison(): void {
    if (!this.showComparison) {
      this.showNotification('No comparison to download', 'warning');
      return;
    }

    const report = {
      timestamp: new Date().toISOString(),
      sampleImage: this.selectedSampleImage?.name,
      printedImage: this.selectedPrintedImage?.name,
      results: this.comparisonResults,
      status: this.comparisonResults.overallMatch ? 'PASS' : 'FAIL'
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `label-comparison-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showNotification('Comparison report downloaded', 'success');
  }

  private showNotification(message: string, type: 'success' | 'error' | 'warning' | 'info'): void {
    this.snackBar.open(message, 'Close', {
      duration: 3000,
      panelClass: [`snackbar-${type}`]
    });
  }

  get sampleImages(): CapturedImage[] {
    return this.capturedImages.filter(img => img.type === 'sample');
  }

  get printedImages(): CapturedImage[] {
    return this.capturedImages.filter(img => img.type === 'printed');
  }

  get canCompare(): boolean {
    return this.selectedSampleImage !== null && this.selectedPrintedImage !== null;
  }
} 