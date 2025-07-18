import { Component, OnInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { LabelScheduleService } from '../../services/label-schedule.service';
import { LabelScheduleData, ExcelImportResult, LabelScheduleFilter } from '../../models/label-schedule.model';

interface CapturedImage {
  dataUrl: string;
  timestamp: Date;
  type: 'sample' | 'printed';
  name: string;
}

// Keep old interface for backward compatibility, but we'll use LabelScheduleData for the real data
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
  @ViewChild('calibrationVideoElement', { static: false }) calibrationVideoElement!: ElementRef<HTMLVideoElement>;

  // Active tab management
  activeTab: 'schedules' | 'check' | 'calibration' = 'schedules';

  // Print Schedules properties - Real data from Firebase
  realSchedules: LabelScheduleData[] = [];
  filteredRealSchedules: LabelScheduleData[] = [];
  
  // Mock data for demo purposes (will be replaced by real data)
  printSchedules: PrintSchedule[] = [];
  filteredSchedules: PrintSchedule[] = [];
  
  // Search and filter properties
  searchTerm = '';
  statusFilter = 'all';
  priorityFilter = 'all';
  yearFilter = 'all';
  customerFilter = 'all';
  
  // Excel import properties
  @ViewChild('fileInput', { static: false }) fileInput!: ElementRef<HTMLInputElement>;
  isImporting = false;
  importResult: ExcelImportResult | null = null;
  showImportDialog = false;
  
  // Filter options
  availableYears: number[] = [];
  availableCustomers: string[] = [];
  availableStatuses: string[] = [];

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
    labelSize: 0,
    fontMatch: 0,
    textSize: 0,
    overallShape: 0,
    overallMatch: false,
    confidence: 0
  };

  // Comparison mode
  isCalibrationMode = false;

  // Calibration sheet properties
  fontSizes = [
    { pt: 8, mm: 2.8 },
    { pt: 10, mm: 3.5 },
    { pt: 12, mm: 4.2 },
    { pt: 14, mm: 4.9 },
    { pt: 16, mm: 5.6 },
    { pt: 18, mm: 6.3 },
    { pt: 20, mm: 7.1 },
    { pt: 22, mm: 7.8 },
    { pt: 24, mm: 8.5 }
  ];

  sampleText = 'RSBG Project Label';
  
  // Calibration verification properties
  isCalibrationCameraActive = false;
  calibrationMediaStream: MediaStream | null = null;
  calibrationCapturedImage: CapturedImage | null = null;
  showCalibrationVerification = false;
  calibrationResults = {
    alignmentAccuracy: 0,
    sizeAccuracy: 0,
    positionAccuracy: 0,
    overallAccuracy: 0,
    isPassing: false
  };
  
  // Ruler increments for A4 sheet
  horizontalMarks: number[] = [];
  verticalMarks: number[] = [];

  constructor(
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    private labelScheduleService: LabelScheduleService
  ) {}

  ngOnInit(): void {
    this.loadMockPrintSchedules();
    this.loadRealSchedules();
    this.loadFilterOptions();
    this.filterSchedules();
    this.generateRulerMarks();
  }

  ngOnDestroy(): void {
    this.stopCamera();
  }

  // Tab Management
  switchTab(tab: 'schedules' | 'check' | 'calibration'): void {
    this.activeTab = tab;
    if (tab === 'check') {
      // Initialize camera when switching to check tab
      setTimeout(() => this.requestCameraPermission(), 100);
    } else {
      // Stop camera when switching away from check tab
      this.stopCamera();
    }
  }

  generateRulerMarks(): void {
    // Generate horizontal marks (0-210mm for A4 width)
    for (let i = 0; i <= 210; i++) {
      this.horizontalMarks.push(i);
    }

    // Generate vertical marks (0-297mm for A4 height)
    for (let i = 0; i <= 297; i++) {
      this.verticalMarks.push(i);
    }
  }

  // === PRINT SCHEDULES FUNCTIONALITY ===
  
  private loadRealSchedules(): void {
    this.labelScheduleService.getAllSchedules().subscribe({
      next: (schedules) => {
        this.realSchedules = schedules;
        this.filterRealSchedules();
      },
      error: (error) => {
        console.error('Error loading schedules:', error);
        this.showNotification('Lỗi khi tải dữ liệu lịch in', 'error');
      }
    });
  }

  private loadFilterOptions(): void {
    // Load years for filter
    this.labelScheduleService.getUniqueYears().subscribe({
      next: (years) => {
        this.availableYears = years;
      }
    });

    // Load customers for filter
    this.labelScheduleService.getUniqueCustomers().subscribe({
      next: (customers) => {
        this.availableCustomers = customers;
      }
    });

    // Load statuses for filter
    this.labelScheduleService.getUniqueStatuses().subscribe({
      next: (statuses) => {
        this.availableStatuses = statuses;
      }
    });
  }

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

  filterRealSchedules(): void {
    this.filteredRealSchedules = this.realSchedules.filter(schedule => {
      const matchesSearch = this.searchTerm === '' || 
                           schedule.maTem.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
                           schedule.khachHang.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
                           schedule.maSanPham.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
                           schedule.soLenhSanXuat.toLowerCase().includes(this.searchTerm.toLowerCase());
      
      const matchesStatus = this.statusFilter === 'all' || schedule.status === this.statusFilter;
      const matchesYear = this.yearFilter === 'all' || schedule.nam === parseInt(this.yearFilter);
      const matchesCustomer = this.customerFilter === 'all' || schedule.khachHang === this.customerFilter;
      
      return matchesSearch && matchesStatus && matchesYear && matchesCustomer;
    });
  }

  onSearchChange(): void {
    this.filterSchedules();
    this.filterRealSchedules();
  }

  onStatusFilterChange(): void {
    this.filterSchedules();
    this.filterRealSchedules();
  }

  onPriorityFilterChange(): void {
    this.filterSchedules();
    this.filterRealSchedules();
  }

  onYearFilterChange(): void {
    this.filterRealSchedules();
  }

  onCustomerFilterChange(): void {
    this.filterRealSchedules();
  }

  // === EXCEL IMPORT FUNCTIONALITY ===
  
  triggerFileInput(): void {
    if (this.fileInput) {
      this.fileInput.nativeElement.click();
    }
  }

  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.importExcelFile(file);
    }
    // Reset file input
    event.target.value = '';
  }

  async importExcelFile(file: File): Promise<void> {
    if (!file.name.match(/\.(xlsx|xls)$/)) {
      this.showNotification('Vui lòng chọn file Excel (.xlsx hoặc .xls)', 'error');
      return;
    }

    this.isImporting = true;
    this.importResult = null;

    try {
      const result = await this.labelScheduleService.importFromExcel(file);
      this.importResult = result;
      
      if (result.success) {
        this.showNotification(
          `Import thành công! ${result.validRows}/${result.totalRows} dòng hợp lệ`, 
          'success'
        );
        
        if (result.validRows > 0) {
          this.showImportDialog = true;
        }
      } else {
        this.showNotification('Import thất bại. Kiểm tra lại file Excel', 'error');
      }
    } catch (error) {
      console.error('Import error:', error);
      this.showNotification('Lỗi khi đọc file Excel', 'error');
    } finally {
      this.isImporting = false;
    }
  }

  async confirmImport(): Promise<void> {
    if (!this.importResult || !this.importResult.data.length) {
      return;
    }

    this.isImporting = true;
    
    try {
      await this.labelScheduleService.bulkAddSchedules(this.importResult.data);
      this.showNotification(
        `Đã lưu ${this.importResult.data.length} lịch in thành công!`, 
        'success'
      );
      this.showImportDialog = false;
      this.importResult = null;
      this.loadRealSchedules(); // Reload data
    } catch (error) {
      console.error('Save error:', error);
      this.showNotification('Lỗi khi lưu dữ liệu', 'error');
    } finally {
      this.isImporting = false;
    }
  }

  cancelImport(): void {
    this.showImportDialog = false;
    this.importResult = null;
  }

  exportSchedules(): void {
    if (this.filteredRealSchedules.length === 0) {
      this.showNotification('Không có dữ liệu để export', 'warning');
      return;
    }

    const filename = `label-schedules-${new Date().toISOString().split('T')[0]}`;
    this.labelScheduleService.exportToExcel(this.filteredRealSchedules, filename);
    this.showNotification('File Excel đã được tải xuống', 'success');
  }

  // === SCHEDULE OPERATIONS ===
  
  deleteSchedule(schedule: LabelScheduleData): void {
    if (!schedule.id) return;
    
    if (confirm(`Bạn có chắc muốn xóa lịch in "${schedule.maTem}"?`)) {
      this.labelScheduleService.deleteSchedule(schedule.id).then(() => {
        this.showNotification('Đã xóa lịch in', 'success');
        this.loadRealSchedules();
      }).catch(error => {
        console.error('Delete error:', error);
        this.showNotification('Lỗi khi xóa lịch in', 'error');
      });
    }
  }

  updateScheduleStatus(schedule: LabelScheduleData, status: string): void {
    if (!schedule.id) return;
    
    this.labelScheduleService.updateSchedule(schedule.id, { status: status as any }).then(() => {
      this.showNotification(`Đã cập nhật trạng thái thành ${status}`, 'success');
      this.loadRealSchedules();
    }).catch(error => {
      console.error('Update error:', error);
      this.showNotification('Lỗi khi cập nhật trạng thái', 'error');
    });
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
    // Generate scores from 60-100 for each metric
    const labelSize = Math.floor(60 + Math.random() * 40);
    const fontMatch = Math.floor(65 + Math.random() * 35);
    const textSize = Math.floor(70 + Math.random() * 30);
    const overallShape = Math.floor(55 + Math.random() * 45);
    
    // Overall accuracy is average of all metrics
    const avgScore = Math.round((labelSize + fontMatch + textSize + overallShape) / 4);
    const overallMatch = avgScore >= 80;
    const confidence = avgScore;

    return {
      labelSize,
      fontMatch,
      textSize,
      overallShape,
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

  // === CALIBRATION SHEET FUNCTIONALITY ===

  printCalibrationSheet(): void {
    window.print();
  }

  downloadCalibrationSheet(): void {
    const printContents = document.getElementById('calibration-sheet')?.innerHTML;
    
    if (printContents) {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>RSBG Calibration Sheet</title>
              <style>
                @page {
                  size: A4;
                  margin: 0;
                }
                
                * {
                  margin: 0;
                  padding: 0;
                  box-sizing: border-box;
                }
                
                body {
                  font-family: Arial, sans-serif;
                  background: white;
                }
                
                .calibration-sheet {
                  width: 210mm;
                  height: 297mm;
                  position: relative;
                  background: white;
                  overflow: hidden;
                }
                
                /* Grid Lines */
                .grid-container {
                  position: absolute;
                  top: 0;
                  left: 0;
                  width: 100%;
                  height: 100%;
                }
                
                .grid-line-h {
                  position: absolute;
                  left: 0;
                  right: 0;
                  height: 0.1mm;
                  background: #ddd;
                }
                
                .grid-line-v {
                  position: absolute;
                  top: 0;
                  bottom: 0;
                  width: 0.1mm;
                  background: #ddd;
                }
                
                /* Rulers */
                .ruler-horizontal {
                  position: absolute;
                  top: 0;
                  left: 0;
                  width: 100%;
                  height: 10mm;
                  background: white;
                  border-bottom: 1px solid #000;
                }
                
                .ruler-vertical {
                  position: absolute;
                  top: 0;
                  left: 0;
                  width: 10mm;
                  height: 100%;
                  background: white;
                  border-right: 1px solid #000;
                }
                
                .ruler-mark-h {
                  position: absolute;
                  bottom: 0;
                  width: 0.2mm;
                  background: #000;
                }
                
                .ruler-mark-v {
                  position: absolute;
                  right: 0;
                  height: 0.2mm;
                  background: #000;
                }
                
                .major-mark-h {
                  height: 3mm;
                }
                
                .minor-mark-h {
                  height: 1.5mm;
                }
                
                .major-mark-v {
                  width: 3mm;
                }
                
                .minor-mark-v {
                  width: 1.5mm;
                }
                
                .ruler-number-h {
                  position: absolute;
                  bottom: 3.5mm;
                  font-size: 6pt;
                  font-weight: bold;
                  color: #000;
                  transform: translateX(-50%);
                }
                
                .ruler-number-v {
                  position: absolute;
                  right: 3.5mm;
                  font-size: 6pt;
                  font-weight: bold;
                  color: #000;
                  transform: translateY(-50%) rotate(-90deg);
                  transform-origin: center;
                }
                
                /* Content Area */
                .content-area {
                  position: absolute;
                  top: 15mm;
                  left: 15mm;
                  right: 10mm;
                  bottom: 10mm;
                }
                
                .header {
                  text-align: center;
                  margin-bottom: 8mm;
                }
                
                .header h1 {
                  font-size: 16pt;
                  font-weight: bold;
                  margin-bottom: 2mm;
                }
                
                .header p {
                  font-size: 10pt;
                  color: #666;
                }
                
                .font-chart {
                  margin-bottom: 10mm;
                }
                
                .font-chart h2 {
                  font-size: 12pt;
                  font-weight: bold;
                  margin-bottom: 5mm;
                  border-bottom: 0.5mm solid #000;
                  padding-bottom: 1mm;
                }
                
                .font-row {
                  display: flex;
                  align-items: center;
                  margin-bottom: 3mm;
                  padding: 1mm 0;
                  border-bottom: 0.1mm solid #eee;
                }
                
                .font-info {
                  width: 25mm;
                  font-size: 8pt;
                  color: #666;
                  flex-shrink: 0;
                }
                
                .font-sample-bold {
                  font-weight: bold;
                  margin-right: 5mm;
                  min-width: 60mm;
                }
                
                .font-sample-regular {
                  font-weight: normal;
                }
                
                .measurement-section {
                  margin-top: 15mm;
                }
                
                .measurement-section h2 {
                  font-size: 12pt;
                  font-weight: bold;
                  margin-bottom: 5mm;
                  border-bottom: 0.5mm solid #000;
                  padding-bottom: 1mm;
                }
                
                .measurement-boxes {
                  display: grid;
                  grid-template-columns: repeat(4, 1fr);
                  gap: 5mm;
                  margin-bottom: 10mm;
                }
                
                .measurement-box {
                  border: 0.2mm solid #000;
                  width: 20mm;
                  height: 20mm;
                  position: relative;
                }
                
                .measurement-box::after {
                  content: attr(data-size);
                  position: absolute;
                  bottom: -4mm;
                  left: 50%;
                  transform: translateX(-50%);
                  font-size: 7pt;
                  color: #000;
                }
                
                .footer {
                  position: absolute;
                  bottom: 5mm;
                  left: 15mm;
                  right: 10mm;
                  text-align: center;
                  font-size: 8pt;
                  color: #666;
                  border-top: 0.1mm solid #ccc;
                  padding-top: 2mm;
                }
                
                @media print {
                  .no-print {
                    display: none !important;
                  }
                }
              </style>
            </head>
            <body>
              ${printContents}
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.print();
      }
    }
  }

  isMinorMark(value: number): boolean {
    return value % 5 !== 0;
  }

  isMajorMark(value: number): boolean {
    return value % 5 === 0;
  }

  shouldShowNumber(value: number): boolean {
    return value % 10 === 0 && value > 0;
  }


} 