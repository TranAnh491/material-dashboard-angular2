import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef, ElementRef, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { TrainingReportService, TrainingRecord } from '../../services/training-report.service';
import { DeleteConfirmationService } from '../../services/delete-confirmation.service';
import { DebugFirebaseService } from '../../services/debug-firebase.service';
import { TrainingReportDebugService } from '../../services/training-report-debug.service';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';



interface MatrixEmployee {
  employeeId: string;
  name: string;
  completedSkills: number;
  totalSkills: number;
  temperatureSkill?: 'passed' | 'failed' | 'pending';
  // Add cached progress values
  progressPercentage?: number;
  strokeDashOffset?: string;
  skillIcon?: string;
  skillStatusText?: string;
  skillStatusClass?: string;
}

@Component({
  selector: 'app-equipment',
  templateUrl: './equipment.component.html',
  styleUrls: ['./equipment.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EquipmentComponent implements OnInit {
  @ViewChild('workerSignCanvas') workerSignCanvas?: ElementRef<HTMLCanvasElement>;

  // Make Math available in template
  Math = Math;
  
  isEnglish = false;
  activeSection: 'templates' | 'report' | 'matrix' | 'test' | null = null;
  trainingTemplateTab: 'form' | 'manual' | 'quiz' = 'form';
  manualTabOpened = false;
  manualTabLoading = false;
  quizTabOpened = false;
  reportDataLoaded = false;

  readonly manualDocMeta = {
    companyLine1: 'AIRSPEED MANUFACTURING VIET NAM',
    formTitle: 'BIỂU MẪU ĐÀO TẠO NHÂN VIÊN KHO ( Ngày Đầu)',
    docCode: 'WH-WI0005/DT',
    version: '00',
    issueDate: '05/03/2026'
  };

  warehouseTrainingForm = {
    fullName: '',
    employeeId: '',
    department: '',
    mentor: '',
    trainingFrom: '',
    trainingTo: '',
    jobTraining: [
      { label: 'Nhận biết sơ đồ Kho', pass: false, fail: false },
      { label: 'Phân biệt nguyên liệu và thành phẩm', pass: false, fail: false },
      { label: 'Đọc tem nguyên liệu', pass: false, fail: false },
      { label: 'Đọc tem thành phẩm', pass: false, fail: false },
      { label: 'Đọc Lệnh sản xuất để giao hàng', pass: false, fail: false },
      { label: 'Sử dụng xe đẩy, xe nâng tay', pass: false, fail: false }
    ],
    trainingCommitment: {
      guided: false,
      safetyRules: false
    },
    workerOpinion: {
      suitable: false,
      notSuitable: false,
      other: false,
      otherText: ''
    }
  };

  workerSignature = '';
  private workerSignDrawing = false;

  // Report properties
  reportData: TrainingRecord[] = [];
  filteredReportData: TrainingRecord[] = [];
  isLoadingReport = false;
  displayedColumns: string[] = ['employeeId', 'name', 'trainingContent', 'status', 'trainingDate', 'expiryDate', 'actions'];

  // Cached matrix training data
  private _cachedMatrixEmployees: MatrixEmployee[] = [];
  private _averageCompletionRate: number = 0;
  private _circumference: string = '';
  
  // Matrix pagination for performance
  private _currentMatrixPage: number = 0;
  private _matrixPageSize: number = 20; // Show 20 employees per page (real data only)
  private _paginatedMatrixEmployees: MatrixEmployee[] = [];
  
  // Matrix training computed properties
  get matrixEmployees(): MatrixEmployee[] {
    return this._paginatedMatrixEmployees;
  }
  
  get allMatrixEmployees(): MatrixEmployee[] {
    return this._cachedMatrixEmployees;
  }
  
  get currentMatrixPage(): number {
    return this._currentMatrixPage;
  }
  
  get matrixPageSize(): number {
    return this._matrixPageSize;
  }
  
  get totalMatrixPages(): number {
    return Math.ceil(this._cachedMatrixEmployees.length / this._matrixPageSize);
  }
  
  get hasMatrixPrevPage(): boolean {
    return this._currentMatrixPage > 0;
  }
  
  get hasMatrixNextPage(): boolean {
    return this._currentMatrixPage < this.totalMatrixPages - 1;
  }
  
  get averageCompletionRate(): number {
    return this._averageCompletionRate;
  }
  
  get circumference(): string {
    return this._circumference;
  }
  
  // Matrix pagination methods
  goToMatrixPage(page: number): void {
    if (page >= 0 && page < this.totalMatrixPages) {
      this._currentMatrixPage = page;
      this.updatePaginatedMatrixEmployees();
      this.cdr.markForCheck();
    }
  }
  
  nextMatrixPage(): void {
    if (this.hasMatrixNextPage) {
      this._currentMatrixPage++;
      this.updatePaginatedMatrixEmployees();
      this.cdr.markForCheck();
    }
  }
  
  prevMatrixPage(): void {
    if (this.hasMatrixPrevPage) {
      this._currentMatrixPage--;
      this.updatePaginatedMatrixEmployees();
      this.cdr.markForCheck();
    }
  }
  
  private updatePaginatedMatrixEmployees(): void {
    const startIndex = this._currentMatrixPage * this._matrixPageSize;
    const endIndex = startIndex + this._matrixPageSize;
    this._paginatedMatrixEmployees = this._cachedMatrixEmployees.slice(startIndex, endIndex);
    
    // Only log pagination details if we have data
    if (this._cachedMatrixEmployees.length > 0) {
      console.log(`📄 Pagination Update - Page ${this._currentMatrixPage + 1}:`);
      console.log(`   📊 Total cached: ${this._cachedMatrixEmployees.length}`);
      console.log(`   📄 Page size: ${this._matrixPageSize}`);
      console.log(`   🔍 Start index: ${startIndex}, End index: ${endIndex}`);
      console.log(`   👥 Showing ${this._paginatedMatrixEmployees.length} employees on this page`);
      if (this._paginatedMatrixEmployees.length > 0) {
        console.log(`   📋 Page employees:`, this._paginatedMatrixEmployees.map(emp => `${emp.employeeId} (${emp.name})`));
      }
    }
  }



  constructor(
    private router: Router,
    private trainingReportService: TrainingReportService,
    private deleteConfirmationService: DeleteConfirmationService,
    private debugFirebaseService: DebugFirebaseService,
    private trainingReportDebugService: TrainingReportDebugService,
    private cdr: ChangeDetectorRef
  ) {
    // Pre-calculate circumference once
    this._circumference = this.calculateCircumference();
  }

  ngOnInit(): void {
    void this.loadDashboardData();
  }

  dashboardSearch = '';

  private async loadDashboardData(): Promise<void> {
    if (!this.reportDataLoaded) {
      await this.loadReportData();
      this.reportDataLoaded = true;
    }
    this.cacheMatrixTrainingData();
    this.cdr.markForCheck();
  }

  createNewSop(): void {
    this.openSection('templates');
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  get dashGreetingName(): string {
    return 'Admin';
  }

  get dashTotalSop(): number {
    const contents = new Set(
      this.reportData.map(r => String(r.trainingContent || '').trim()).filter(Boolean)
    );
    return Math.max(12, contents.size + 8);
  }

  get dashTrainedCount(): number {
    const passed = this.reportData.filter(r => r.status === 'pass');
    return new Set(passed.map(r => r.employeeId)).size;
  }

  get dashPendingCount(): number {
    return this._cachedMatrixEmployees.filter(
      e => e.temperatureSkill === 'pending' || e.temperatureSkill === 'failed'
    ).length;
  }

  get dashPassRate(): number {
    if (!this.reportData.length) {
      return 0;
    }
    const passed = this.reportData.filter(r => r.status === 'pass').length;
    return Math.round((passed / this.reportData.length) * 100);
  }

  get dashWarehouseProgress(): number {
    return this._averageCompletionRate || this.dashPassRate || 0;
  }

  get dashMonthlyBars(): { label: string; value: number }[] {
    const months = this.isEnglish
      ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
      : ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
    const now = new Date();
    const year = now.getFullYear();
    const counts = new Array(6).fill(0);
    this.reportData.forEach(r => {
      const d = r.trainingDate ? new Date(r.trainingDate) : null;
      if (!d || d.getFullYear() !== year) return;
      const m = d.getMonth();
      if (m >= 0 && m < 6) counts[m]++;
    });
    const max = Math.max(...counts, 1);
    return months.map((label, i) => ({
      label,
      value: Math.max(12, Math.round((counts[i] / max) * 100))
    }));
  }

  get dashRecentActivities(): { icon: string; color: string; text: string; time: string }[] {
    const sorted = [...this.reportData].sort((a, b) => {
      const ta = a.trainingDate ? new Date(a.trainingDate).getTime() : 0;
      const tb = b.trainingDate ? new Date(b.trainingDate).getTime() : 0;
      return tb - ta;
    });
    return sorted.slice(0, 5).map(r => ({
      icon: r.status === 'pass' ? 'check_circle' : 'schedule',
      color: r.status === 'pass' ? '#22c55e' : '#f59e0b',
      text: this.isEnglish
        ? `${r.name} — ${r.trainingContent} (${r.status === 'pass' ? 'Pass' : 'Pending'})`
        : `${r.name} — ${r.trainingContent} (${r.status === 'pass' ? 'Đạt' : 'Chưa đạt'})`,
      time: r.trainingDate
        ? new Date(r.trainingDate).toLocaleDateString(this.isEnglish ? 'en-GB' : 'vi-VN')
        : (this.isEnglish ? 'Recently' : 'Gần đây')
    }));
  }

  matchesDashboardSearch(text: string): boolean {
    const q = this.dashboardSearch.trim().toLowerCase();
    if (!q) return true;
    return text.toLowerCase().includes(q);
  }

  openSection(section: 'templates' | 'report' | 'matrix' | 'test'): void {
    this.activeSection = this.activeSection === section ? null : section;
    if (this.activeSection === 'report' && !this.reportDataLoaded) {
      void this.refreshReportData();
    }
    if (this.activeSection === 'matrix') {
      this.cacheMatrixTrainingData();
    }
    this.cdr.markForCheck();
  }

  isSectionOpen(section: 'templates' | 'report' | 'matrix' | 'test'): boolean {
    return this.activeSection === section;
  }

  toggleLanguage() {
    this.isEnglish = !this.isEnglish;
  }



  openTemperatureKnowledgeTest() {
    // Navigate to Temperature Knowledge Test component
    this.router.navigate(['/temperature-knowledge-test']);
  }

  downloadWHWI0005Document(part: 'Part A' | 'Part B' | 'Full') {
    const documentUrls = {
      'Part A': 'https://docs.google.com/document/d/your-part-a-document-id/edit',
      'Part B': 'https://docs.google.com/document/d/your-part-b-document-id/edit', 
      'Full': 'https://docs.google.com/document/d/your-full-document-id/edit'
    };
    
    const url = documentUrls[part];
    if (url) {
      window.open(url, '_blank');
      console.log(`Downloading WH-WI0005 ${part} document`);
    } else {
      alert(this.isEnglish ? 
        'Document link not configured yet. Please contact administrator.' :
        'Liên kết tài liệu chưa được cấu hình. Vui lòng liên hệ quản trị viên.');
    }
  }

  openWHWI0005Ver08Document() {
    // Open the WH-WI0005 Ver08 document
    const documentUrl = 'https://docs.google.com/document/d/your-wh-wi0005-ver08-document-id/edit';
    
    if (documentUrl && documentUrl !== 'https://docs.google.com/document/d/your-wh-wi0005-ver08-document-id/edit') {
      window.open(documentUrl, '_blank');
      console.log('Opening WH-WI0005 Ver08 document');
    } else {
      alert(this.isEnglish ? 
        'WH-WI0005 Ver08 document link not configured yet. Please contact administrator.' :
        'Liên kết tài liệu WH-WI0005 Ver08 chưa được cấu hình. Vui lòng liên hệ quản trị viên.');
    }
  }

  downloadWHWI0005Ver08Document() {
    // Download the WH-WI0005 Ver08 document
    const documentUrl = 'https://docs.google.com/document/d/your-wh-wi0005-ver08-document-id/export?format=docx';
    window.open(documentUrl, '_blank');
    console.log('Downloading WH-WI0005 Ver08 document');
  }

  openMaterialsTest() {
    // Navigate to Materials Test component
    console.log('Opening Materials Test - WH-WI0005 Part A');
    this.router.navigate(['/materials-test']);
  }

  openFinishedGoodsTest() {
    // Navigate to Finished Goods Test component
    console.log('Opening Finished Goods Test - WH-WI0005 Part B');
    this.router.navigate(['/finished-goods-test']);
  }



  toggleTest(): void { this.openSection('test'); }
  toggleReport(): void { this.openSection('report'); }
  toggleMatrixTraining(): void { this.openSection('matrix'); }
  toggleTrainingTemplates(): void { this.openSection('templates'); }

  setTrainingTemplateTab(tab: 'form' | 'manual' | 'quiz'): void {
    this.trainingTemplateTab = tab;
    if (tab === 'manual' && !this.manualTabOpened) {
      this.manualTabLoading = true;
      this.cdr.markForCheck();
      requestAnimationFrame(() => {
        this.manualTabOpened = true;
        this.manualTabLoading = false;
        this.cdr.markForCheck();
      });
      return;
    }
    if (tab === 'quiz') {
      this.quizTabOpened = true;
    }
    this.cdr.markForCheck();
  }

  previewTrainingForm(): void {
    document.getElementById('warehouseTrainingPrintArea')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  downloadTrainingFormPdf(): void {
    this.printWarehouseTrainingForm();
  }

  logoSrc = '/assets/img/logo.png';

  onJobTrainingPassChange(index: number): void {
    const item = this.warehouseTrainingForm.jobTraining[index];
    if (item.pass) {
      item.fail = false;
    }
    this.cdr.markForCheck();
  }

  onJobTrainingFailChange(index: number): void {
    const item = this.warehouseTrainingForm.jobTraining[index];
    if (item.fail) {
      item.pass = false;
    }
    this.cdr.markForCheck();
  }

  onWorkerOpinionSuitableChange(): void {
    if (this.warehouseTrainingForm.workerOpinion.suitable) {
      this.warehouseTrainingForm.workerOpinion.notSuitable = false;
    }
    this.cdr.markForCheck();
  }

  onWorkerOpinionNotSuitableChange(): void {
    if (this.warehouseTrainingForm.workerOpinion.notSuitable) {
      this.warehouseTrainingForm.workerOpinion.suitable = false;
    }
    this.cdr.markForCheck();
  }

  resetWarehouseTrainingForm(): void {
    this.warehouseTrainingForm = {
      fullName: '',
      employeeId: '',
      department: '',
      mentor: '',
      trainingFrom: '',
      trainingTo: '',
      jobTraining: this.warehouseTrainingForm.jobTraining.map(item => ({
        label: item.label,
        pass: false,
        fail: false
      })),
      trainingCommitment: {
        guided: false,
        safetyRules: false
      },
      workerOpinion: {
        suitable: false,
        notSuitable: false,
        other: false,
        otherText: ''
      }
    };
    this.workerSignature = '';
    this.clearWorkerSignature();
    this.cdr.markForCheck();
  }

  private getWorkerSignCtx(): CanvasRenderingContext2D | null {
    const canvas = this.workerSignCanvas?.nativeElement;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return ctx;
  }

  private workerSignPoint(event: MouseEvent | TouchEvent, canvas: HTMLCanvasElement): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  startWorkerSign(event: MouseEvent | TouchEvent): void {
    event.preventDefault();
    const canvas = this.workerSignCanvas?.nativeElement;
    const ctx = this.getWorkerSignCtx();
    if (!canvas || !ctx) return;
    this.workerSignDrawing = true;
    const p = this.workerSignPoint(event, canvas);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  moveWorkerSign(event: MouseEvent | TouchEvent): void {
    if (!this.workerSignDrawing) return;
    event.preventDefault();
    const canvas = this.workerSignCanvas?.nativeElement;
    const ctx = this.getWorkerSignCtx();
    if (!canvas || !ctx) return;
    const p = this.workerSignPoint(event, canvas);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  endWorkerSign(): void {
    if (!this.workerSignDrawing) return;
    this.workerSignDrawing = false;
    const canvas = this.workerSignCanvas?.nativeElement;
    if (!canvas) return;
    this.workerSignature = canvas.toDataURL('image/png');
    this.cdr.markForCheck();
  }

  clearWorkerSignature(): void {
    const canvas = this.workerSignCanvas?.nativeElement;
    const ctx = this.getWorkerSignCtx();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.workerSignature = '';
    this.cdr.markForCheck();
  }

  printWarehouseTrainingForm(): void {
    window.print();
  }

  closeAll() {
    this.activeSection = null;
    this.cdr.markForCheck();
  }

  // Report methods
  async loadReportData() {
    this.isLoadingReport = true;
    try {
      this.reportData = await this.trainingReportService.getTrainingReports();
      
      // Verify that all records still exist in database
      const validRecords: TrainingRecord[] = [];
      for (const record of this.reportData) {
        if (record.id) {
          const exists = await this.trainingReportService.recordExists(record.id);
          if (exists) {
            validRecords.push(record);
          } else {
            console.log(`⚠️ Record ${record.id} (${record.employeeId}) no longer exists in database, removing from list`);
          }
        } else {
          // Records without ID are still valid
          validRecords.push(record);
        }
      }
      
      this.reportData = validRecords;
      this.filteredReportData = [...this.reportData];
      this.reportDataLoaded = true;
      this.cdr.markForCheck();
    } catch (error) {
      console.error('❌ Error loading report data:', error);
      this.reportData = [];
      this.filteredReportData = [];
      this.reportDataLoaded = true;
    }
    this.isLoadingReport = false;
  }

  async refreshReportData() {
    console.log('🔄 Force refreshing report data...');
    // Clear existing data first
    this.reportData = [];
    this.filteredReportData = [];
    
    // Reload data
    await this.loadReportData();
    
    // Force change detection to update UI
    this.cdr.detectChanges();
    
    console.log('✅ Report data refreshed successfully');
  }





  isExpired(expiryDate: Date): boolean {
    return expiryDate < new Date();
  }

  async deleteEmployee(record: TrainingRecord) {
    if (!record.id) {
      alert('Không thể xóa: Thiếu ID bản ghi');
      return;
    }

    // Use Delete Confirmation Dialog with authentication
    const confirmed = await this.deleteConfirmationService.confirmDeleteRecord(
      `${record.name} (${record.employeeId})`
    ).toPromise();

    if (confirmed) {
      try {
        const success = await this.trainingReportService.deleteTrainingRecord(record.id);
        if (success) {
          // Remove from local data
          this.reportData = this.reportData.filter(r => r.id !== record.id);
          this.filteredReportData = this.filteredReportData.filter(r => r.id !== record.id);
          
          // Force change detection to update UI immediately
          this.cdr.detectChanges();
          
          // Ask user if they want to refresh data
          const shouldRefresh = confirm('Đã xóa bản ghi thành công!\n\nBạn có muốn làm mới dữ liệu để đảm bảo thay đổi được cập nhật không?');
          if (shouldRefresh) {
            await this.refreshReportData();
          }
        } else {
          alert('Có lỗi xảy ra khi xóa bản ghi!\n\nVui lòng thử lại hoặc liên hệ quản trị viên nếu vấn đề vẫn tiếp tục.');
        }
      } catch (error) {
        console.error('Error deleting record:', error);
        alert('Có lỗi xảy ra khi xóa bản ghi!');
      }
    }
  }

  async downloadEmployeeReport(record: TrainingRecord) {
    if (!record.id) {
      alert('Không thể tải file: Thiếu ID bản ghi');
      return;
    }

    try {
      // Get full record data from Firebase
      const fullRecord = await this.trainingReportService.getTrainingRecordById(record.id);
      if (!fullRecord) {
        alert('Không tìm thấy dữ liệu chi tiết của bản ghi này!');
        return;
      }

      // Debug: Log signature data
      console.log('Full record signature:', fullRecord.signature ? 'Available' : 'Not available');
      console.log('Record signature:', record.signature ? 'Available' : 'Not available');

      // Use signature from full record if available, fallback to record signature
      const signatureToUse = fullRecord.signature || record.signature;
      console.log('Final signature to use:', signatureToUse ? 'Available' : 'Not available');
      
      if (signatureToUse) {
        console.log('Signature data length:', signatureToUse.length);
        console.log('Signature starts with data:image:', signatureToUse.startsWith('data:image/'));
      }

      // Show loading message with signature status
      const hasSignature = !!signatureToUse;
      const message = hasSignature 
        ? `Đang tạo báo cáo cho ${record.name} (có chữ ký)...`
        : `Đang tạo báo cáo cho ${record.name} (không có chữ ký)...`;
      
      console.log(message);
      
      // Generate PDF with signature
      await this.generateEmployeePDF(record, fullRecord, signatureToUse);

    } catch (error) {
      console.error('Error downloading employee report:', error);
      alert('Có lỗi xảy ra khi tải file báo cáo!');
    }
  }

  private async generateEmployeePDF(record: TrainingRecord, fullRecord: any, signature?: string) {
    try {
      console.log(`🔄 Generating PDF for ${record.name} with signature: ${signature ? 'Yes' : 'No'}`);
      
      // Create PDF content as HTML
      const pdfContent = this.createEmployeePDFContent(record, fullRecord, signature);
      
      // Create a temporary container
      const tempContainer = document.createElement('div');
      tempContainer.innerHTML = pdfContent;
      tempContainer.style.position = 'absolute';
      tempContainer.style.left = '-9999px';
      tempContainer.style.top = '-9999px';
      tempContainer.style.width = '794px';
      tempContainer.style.backgroundColor = 'white';
      tempContainer.style.fontFamily = 'Arial, sans-serif';
      tempContainer.style.fontSize = '14px';
      tempContainer.style.lineHeight = '1.5';
      tempContainer.style.color = '#000';
      tempContainer.style.padding = '40px';
      
      document.body.appendChild(tempContainer);

      // Wait for fonts to load
      await new Promise(resolve => setTimeout(resolve, 100));

      // Convert to canvas with proper height handling
      const canvas = await html2canvas(tempContainer, {
        width: 794,
        scale: 1.5,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        height: tempContainer.scrollHeight,
        scrollX: 0,
        scrollY: 0
      });

      // Remove temporary container
      document.body.removeChild(tempContainer);

      console.log(`📄 Canvas created: ${canvas.width}x${canvas.height}`);

      // Create PDF with multiple pages if needed
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = 210; // A4 width in mm
      const pdfHeight = 297; // A4 height in mm
      
      const imgWidth = pdfWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      const imgData = canvas.toDataURL('image/png');
      
      console.log(`📄 Image dimensions: ${imgWidth}mm x ${imgHeight}mm`);
      
      // If content fits on one page
      if (imgHeight <= pdfHeight) {
        pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
      } else {
        // Split content across multiple pages
        const totalPages = Math.ceil(imgHeight / pdfHeight);
        console.log(`📄 Creating ${totalPages} pages for PDF`);
        
        for (let i = 0; i < totalPages; i++) {
          if (i > 0) {
            pdf.addPage();
          }
          
          const offsetY = -(i * pdfHeight);
          pdf.addImage(imgData, 'PNG', 0, offsetY, imgWidth, imgHeight);
        }
      }

      // Save the PDF
      const fileName = `Bao_Cao_Chi_Tiet_${record.employeeId}_${record.trainingDate.toLocaleDateString('vi-VN').replace(/\//g, '_')}.pdf`;
      pdf.save(fileName);
      
      console.log(`✅ PDF saved successfully: ${fileName} ${signature ? '(with signature)' : '(without signature)'}`);
      
      // Show success message
      const successMessage = signature 
        ? `Đã tải thành công báo cáo có chữ ký của ${record.name}!`
        : `Đã tải thành công báo cáo của ${record.name} (không có chữ ký)!`;
      
      // Could show a toast notification here instead of alert
      setTimeout(() => {
        console.log(successMessage);
      }, 100);

    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Có lỗi xảy ra khi tạo file PDF!');
    }
  }

  private createEmployeePDFContent(record: TrainingRecord, fullRecord: any, signature?: string): string {
    const formatDate = (date: Date) => date.toLocaleDateString('vi-VN');
    const formatTime = (date: Date) => date.toLocaleTimeString('vi-VN');

    return `
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="margin: 0 0 10px 0; font-size: 20px; font-weight: bold; color: #2c3e50;">BÁO CÁO ĐÀO TẠO NHÂN VIÊN</h1>
        <h2 style="margin: 0 0 8px 0; font-size: 16px; font-weight: normal; color: #34495e;">${record.trainingContent}</h2>

      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 14px;">
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold; background-color: #f8f9fa; width: 40%;">Mã nhân viên:</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${record.employeeId}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold; background-color: #f8f9fa;">Tên nhân viên:</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${record.name}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold; background-color: #f8f9fa;">Ngày đào tạo:</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${formatDate(record.trainingDate)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold; background-color: #f8f9fa;">Thời gian hoàn thành:</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${formatTime(record.trainingDate)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold; background-color: #f8f9fa;">Điểm số:</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${record.score || 0}/${record.totalQuestions || 0}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold; background-color: #f8f9fa;">Tỷ lệ đúng:</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${record.percentage || 0}%</td>
        </tr>
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold; background-color: #f8f9fa;">Kết quả:</td>
          <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold; color: ${record.status === 'pass' ? '#27ae60' : '#e74c3c'};">
            ${record.status === 'pass' ? 'ĐẠT' : 'KHÔNG ĐẠT'}
          </td>
        </tr>
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold; background-color: #f8f9fa;">Ngày hết hạn:</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${formatDate(record.expiryDate)}</td>
        </tr>
      </table>

             ${signature ? `
         <div style="margin-bottom: 30px;">
           <h3 style="margin: 0 0 15px 0; font-size: 16px; font-weight: bold; color: #2c3e50;">Chữ ký nhân viên:</h3>
           <div style="border: 2px solid #ddd; padding: 10px; border-radius: 8px; text-align: center; background-color: #f8f9fa;">
             <img src="${signature}" style="max-width: 200px; max-height: 100px;" />
           </div>
           <p style="text-align: center; margin-top: 10px; font-size: 12px; color: #7f8c8d;">
             Chữ ký được ký ngày ${formatDate(record.trainingDate)}
           </p>
         </div>
       ` : `
         <div style="margin-bottom: 30px;">
           <h3 style="margin: 0 0 15px 0; font-size: 16px; font-weight: bold; color: #2c3e50;">Chữ ký nhân viên:</h3>
           <div style="border: 2px dashed #ddd; padding: 20px; border-radius: 8px; text-align: center; background-color: #f8f9fa;">
             <p style="color: #7f8c8d; margin: 0; font-style: italic;">Không có chữ ký điện tử</p>
           </div>
         </div>
       `}

      ${this.createDetailedAnswersSection(fullRecord)}

      <div style="text-align: center; margin-top: 50px; font-size: 12px; color: #7f8c8d;">
        <p>Báo cáo được tạo từ hệ thống vào ${formatTime(new Date())} - ${formatDate(new Date())}</p>
        <p><strong>Trạng thái đào tạo:</strong> ${record.status === 'pass' ? 'Hợp lệ' : 'Cần đào tạo lại'}</p>
      </div>
    `;
  }

  private createDetailedAnswersSection(fullRecord: any): string {
    console.log('🔍 Creating detailed answers section - Debug Info:');
    console.log('Full record exists:', !!fullRecord);
    console.log('Answers exist:', !!fullRecord?.answers);
    console.log('TestData exists:', !!fullRecord?.testData);
    console.log('Sections exist:', !!fullRecord?.testData?.sections);

    if (!fullRecord.answers || !fullRecord.testData || !fullRecord.testData.sections) {
      console.log('❌ Missing data for detailed answers section');
      return `
        <div style="margin-bottom: 30px;">
          <h3 style="margin: 0 0 15px 0; font-size: 16px; font-weight: bold; color: #2c3e50;">Lịch sử bài kiểm tra:</h3>
          <div style="border: 2px dashed #ddd; padding: 20px; border-radius: 8px; text-align: center; background-color: #f8f9fa;">
            <p style="color: #7f8c8d; margin: 0; font-style: italic;">Chi tiết câu hỏi không có sẵn cho bài kiểm tra này</p>
          </div>
        </div>
      `;
    }

    console.log('📊 Data available:');
    console.log('- Number of sections:', fullRecord.testData.sections.length);
    console.log('- Number of answers:', fullRecord.answers.length);

    let content = `
      <div style="margin-bottom: 30px;">
        <h3 style="margin: 0 0 20px 0; font-size: 16px; font-weight: bold; color: #2c3e50;">Lịch sử bài kiểm tra chi tiết:</h3>
    `;

    let questionNumber = 1;
    fullRecord.testData.sections.forEach((section: any, sectionIndex: number) => {
      console.log(`📝 Processing section ${sectionIndex}: "${section.title}" with ${section.questions.length} questions`);
      
      content += `
        <div style="margin-bottom: 20px;">
          <h4 style="margin: 0 0 15px 0; font-size: 14px; font-weight: bold; color: #34495e; background-color: #ecf0f1; padding: 10px; border-radius: 6px;">
            ${section.title} (${section.questions.length} câu)
          </h4>
        </div>
      `;

      section.questions.forEach((question: any, questionIndex: number) => {
        console.log(`  - Question ${questionNumber}: Processing question ${questionIndex} in section ${sectionIndex}`);
        
        const answer = fullRecord.answers.find((a: any) => 
          a.sectionIndex === sectionIndex && a.questionIndex === questionIndex
        );
        
        console.log(`    Answer found:`, !!answer, answer ? `(${answer.selectedAnswer}, ${answer.isCorrect ? 'correct' : 'incorrect'})` : '');
        
        const isCorrect = answer?.isCorrect || false;
        const selectedAnswer = answer?.selectedAnswer || 'Không trả lời';

        // Format options for multiple choice questions
        let optionsText = '';
        if (question.options && question.options.length > 0) {
          optionsText = question.options.map((opt: string, idx: number) => 
            `${String.fromCharCode(65 + idx)}. ${opt}`
          ).join(' | ');
        }

        content += `
          <div style="margin-bottom: 15px; border: 2px solid ${isCorrect ? '#27ae60' : '#e74c3c'}; border-radius: 8px; padding: 15px; background-color: ${isCorrect ? '#d5f4e6' : '#fdeaea'};">
            <div style="font-weight: bold; margin-bottom: 10px; color: #2c3e50; font-size: 14px;">
              Câu ${questionNumber}: ${question.question}
            </div>
            ${optionsText ? `
            <div style="margin-bottom: 8px; font-size: 12px; color: #7f8c8d; background-color: #f8f9fa; padding: 8px; border-radius: 4px;">
              <strong>Các lựa chọn:</strong> ${optionsText}
            </div>
            ` : ''}
            <div style="margin-bottom: 6px; font-size: 13px;">
              <strong style="color: #2c3e50;">Đáp án đã chọn:</strong> 
              <span style="color: ${isCorrect ? '#27ae60' : '#e74c3c'}; font-weight: bold;">${selectedAnswer}</span>
            </div>
            <div style="margin-bottom: 8px; font-size: 13px;">
              <strong style="color: #2c3e50;">Đáp án chính xác:</strong> 
              <span style="color: #27ae60; font-weight: bold;">${question.correctAnswer}</span>
            </div>
            <div style="font-weight: bold; font-size: 14px; color: ${isCorrect ? '#27ae60' : '#e74c3c'}; text-align: center; margin-top: 8px;">
              ${isCorrect ? '✓ ĐÚNG' : '✗ SAI'}
            </div>
          </div>
        `;
        questionNumber++;
      });
    });

    console.log(`✅ Generated content for ${questionNumber - 1} questions total`);
    content += `</div>`;
    return content;
  }

  // Matrix Training Functions - Optimized with caching (Real data only)
  private cacheMatrixTrainingData(): void {
    console.log('🔍 Matrix Training Debug - Starting cache process...');
    console.log('📊 Report data length:', this.reportData.length);
    
    // Create matrix data ONLY from existing report data (no mock data)
    const matrixEmployees: MatrixEmployee[] = [];
    
    // Add employees from report data only
    console.log('👥 Processing employees from Training Report data:');
    this.reportData.forEach(record => {
      console.log(`  - Processing: ${record.employeeId} (${record.name}) - Status: ${record.status}`);
      const existing = matrixEmployees.find(emp => emp.employeeId === record.employeeId);
      if (!existing) {
        matrixEmployees.push({
          employeeId: record.employeeId,
          name: record.name,
          completedSkills: record.status === 'pass' ? 1 : 0,
          totalSkills: 1,
          temperatureSkill: record.status === 'pass' ? 'passed' : 'failed'
        });
        console.log(`    ✅ Added real employee: ${record.employeeId} (${record.name})`);
      } else {
        console.log(`    ⚠️ Duplicate employee found, skipping: ${record.employeeId}`);
      }
    });

    console.log(`📈 Total real employees from Training Report: ${matrixEmployees.length}`);

    // Handle empty data case
    if (matrixEmployees.length === 0) {
      console.log('⚠️ No training report data available for Matrix Training');
      console.log('💡 Matrix Training will show empty state');
    }

    console.log(`📋 Total employees before sorting: ${matrixEmployees.length}`);
    
    // Sort and cache with pre-calculated values
    this._cachedMatrixEmployees = matrixEmployees
      .sort((a, b) => a.employeeId.localeCompare(b.employeeId))
      .map(emp => this.enhanceEmployeeWithCalculations(emp));
    
    console.log(`✅ Matrix Training Cache Complete (Training Report Data Only):`);
    console.log(`   📊 Total cached employees: ${this._cachedMatrixEmployees.length}`);
    
    if (this._cachedMatrixEmployees.length > 0) {
      console.log(`   📄 Page size: ${this._matrixPageSize}`);
      console.log(`   📃 Total pages: ${Math.ceil(this._cachedMatrixEmployees.length / this._matrixPageSize)}`);
      
      // List all employees for debugging
      console.log('👥 All Matrix Employees (from Training Report):');
      this._cachedMatrixEmployees.forEach((emp, index) => {
        console.log(`   ${index + 1}. ${emp.employeeId} - ${emp.name} (${emp.temperatureSkill})`);
      });
    } else {
      console.log('   ℹ️ No employees to display - Matrix will show empty state');
    }
    
    // Calculate and cache average completion rate
    this.calculateAverageCompletionRate();
    
    // Reset pagination and update paginated data
    this._currentMatrixPage = 0;
    this.updatePaginatedMatrixEmployees();
    
    if (this._cachedMatrixEmployees.length > 0) {
      console.log(`📄 First page employees (showing ${this._paginatedMatrixEmployees.length} of ${this._cachedMatrixEmployees.length}):`);
      this._paginatedMatrixEmployees.forEach((emp, index) => {
        console.log(`   Page 1 - ${index + 1}. ${emp.employeeId} - ${emp.name}`);
      });
    }
    
    // Trigger change detection
    this.cdr.markForCheck();
  }

  private enhanceEmployeeWithCalculations(employee: MatrixEmployee): MatrixEmployee {
    const progressPercentage = (employee.completedSkills / employee.totalSkills) * 100;
    const strokeDashOffset = this.calculateStrokeDashOffset(employee.completedSkills, employee.totalSkills);
    const skillIcon = this.calculateSkillIcon(employee.temperatureSkill);
    const skillStatusText = this.calculateSkillStatusText(employee.temperatureSkill);
    const skillStatusClass = employee.temperatureSkill || 'pending';

    return {
      ...employee,
      progressPercentage,
      strokeDashOffset,
      skillIcon,
      skillStatusText,
      skillStatusClass
    };
  }

  // Legacy method for backward compatibility
  getMatrixEmployees(): MatrixEmployee[] {
    return this._cachedMatrixEmployees;
  }

  private calculateAverageCompletionRate(): void {
    if (this._cachedMatrixEmployees.length === 0) {
      this._averageCompletionRate = 0;
      return;
    }
    
    const totalCompletionRate = this._cachedMatrixEmployees.reduce((sum, emp) => {
      return sum + (emp.completedSkills / emp.totalSkills);
    }, 0);
    
    this._averageCompletionRate = Math.round((totalCompletionRate / this._cachedMatrixEmployees.length) * 100);
  }

  // Circular Progress Functions - Optimized
  private calculateCircumference(): string {
    const radius = 25;
    const circumference = 2 * Math.PI * radius;
    return `${circumference} ${circumference}`;
  }

  private calculateStrokeDashOffset(completed: number, total: number): string {
    const radius = 25;
    const circumference = 2 * Math.PI * radius;
    const progress = completed / total;
    const offset = circumference - (progress * circumference);
    return offset.toString();
  }

  // Skill Status Functions - Optimized
  private calculateSkillIcon(temperatureSkill?: 'passed' | 'failed' | 'pending'): string {
    switch (temperatureSkill) {
      case 'passed': return 'check_circle';
      case 'failed': return 'cancel';
      case 'pending': return 'schedule';
      default: return 'schedule';
    }
  }

  private calculateSkillStatusText(temperatureSkill?: 'passed' | 'failed' | 'pending'): string {
    switch (temperatureSkill) {
      case 'passed': return this.isEnglish ? 'Passed' : 'Đạt';
      case 'failed': return this.isEnglish ? 'Failed' : 'Không đạt';
      case 'pending': return this.isEnglish ? 'Not Taken' : 'Chưa làm';
      default: return this.isEnglish ? 'Not Taken' : 'Chưa làm';
    }
  }

  // Legacy methods for backward compatibility - these should not be called from template
  getAverageCompletionRate(): number {
    return this._averageCompletionRate;
  }

  getCircumference(): string {
    return this._circumference;
  }

  getStrokeDashOffset(completed: number, total: number): string {
    return this.calculateStrokeDashOffset(completed, total);
  }

  getSkillStatus(employeeId: string, skillType: string): string {
    const employee = this._cachedMatrixEmployees.find(emp => emp.employeeId === employeeId);
    if (!employee) return 'pending';
    
    if (skillType === 'temperature') {
      return employee.temperatureSkill || 'pending';
    }
    
    return 'pending';
  }

  getSkillIcon(employeeId: string, skillType: string): string {
    const employee = this._cachedMatrixEmployees.find(emp => emp.employeeId === employeeId);
    if (!employee) return 'schedule';
    return employee.skillIcon || 'schedule';
  }

  getSkillStatusText(employeeId: string, skillType: string): string {
    const employee = this._cachedMatrixEmployees.find(emp => emp.employeeId === employeeId);
    if (!employee) return this.isEnglish ? 'Not Taken' : 'Chưa làm';
    return employee.skillStatusText || (this.isEnglish ? 'Not Taken' : 'Chưa làm');
  }
} 