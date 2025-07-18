import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { TrainingReportService, TrainingRecord } from '../../services/training-report.service';
import { DeleteConfirmationService } from '../../services/delete-confirmation.service';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface FlowchartStep {
  vi: string;
  en: string;
  icon: string;
  type: 'material' | 'product';
  imageUrl?: string;
}

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

  // Make Math available in template
  Math = Math;
  
  isEnglish = false;
  selectedStep: FlowchartStep | null = null;
  showWorkInstruction = false;
  showTest = false;
  showReport = false;
  showMatrixTraining = false;

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

  steps: FlowchartStep[] = [
    { vi: 'Nhận nguyên liệu', en: 'Receive Materials', icon: 'call_received', type: 'material', imageUrl: 'assets/img/instruction_step_1.png' },
    { vi: 'Kiểm tra nguyên liệu đầu vào', en: 'Inspect Incoming Materials', icon: 'fact_check', type: 'material', imageUrl: 'assets/img/instruction_step_2.png' },
    { vi: 'Lưu trữ nguyên liệu', en: 'Store Materials', icon: 'inventory_2', type: 'material', imageUrl: 'assets/img/instruction_step_3.png' },
    { vi: 'Soạn Nguyên liệu', en: 'Prepare Materials', icon: 'build', type: 'material', imageUrl: 'assets/img/instruction_step_4.png' },
    { vi: 'Kiểm và Giao nguyên liệu', en: 'Check and Deliver Materials', icon: 'local_shipping', type: 'material', imageUrl: 'assets/img/instruction_step_5.png' },
    { vi: 'Nhận Thành Phẩm', en: 'Receive Finished Goods', icon: 'check_circle_outline', type: 'product', imageUrl: 'assets/img/instruction_step_6.png' },
    { vi: 'Lưu trữ Thành Phẩm', en: 'Store Finished Goods', icon: 'inventory', type: 'product', imageUrl: 'assets/img/instruction_step_7.png' },
    { vi: 'Soạn và Giao Thành phẩm', en: 'Prepare and Deliver Finished Goods', icon: 'move_to_inbox', type: 'product', imageUrl: 'assets/img/instruction_step_8.png' }
  ];

  constructor(
    private router: Router,
    private trainingReportService: TrainingReportService,
    private deleteConfirmationService: DeleteConfirmationService,
    private cdr: ChangeDetectorRef
  ) {
    // Pre-calculate circumference once
    this._circumference = this.calculateCircumference();
  }

  ngOnInit(): void {
    if (this.steps.length > 0) {
      this.selectedStep = this.steps[0];
    }
    this.loadReportData();
  }

  toggleLanguage() {
    this.isEnglish = !this.isEnglish;
  }

  selectStep(step: FlowchartStep) {
    this.selectedStep = step;
  }

  openTemperatureKnowledgeTest() {
    this.router.navigate(['/temperature-knowledge-test']);
  }

  openMaterialsTest() {
    // Navigate to Materials Test component (to be created)
    console.log('Opening Materials Test - WH-WI0005 Part A');
    // TODO: Create materials test component and navigate
    // this.router.navigate(['/materials-test']);
    alert(this.isEnglish ? 
      'Materials Test (WH-WI0005 Part A)\n20 questions about raw materials import/export procedures.\nThis test will be implemented soon.' : 
      'Kiểm tra Nguyên vật liệu (WH-WI0005 Phần A)\n20 câu hỏi về quy trình xuất nhập kho nguyên vật liệu.\nBài kiểm tra này sẽ được triển khai sớm.');
  }

  openFinishedGoodsTest() {
    // Navigate to Finished Goods Test component (to be created)
    console.log('Opening Finished Goods Test - WH-WI0005 Part B');
    // TODO: Create finished goods test component and navigate
    // this.router.navigate(['/finished-goods-test']);
    alert(this.isEnglish ? 
      'Finished Goods Test (WH-WI0005 Part B)\n20 questions about finished goods import/export procedures.\nThis test will be implemented soon.' : 
      'Kiểm tra Thành phẩm (WH-WI0005 Phần B)\n20 câu hỏi về quy trình xuất nhập kho thành phẩm.\nBài kiểm tra này sẽ được triển khai sớm.');
  }

  toggleWorkInstruction() {
    this.showWorkInstruction = !this.showWorkInstruction;
    if (this.showWorkInstruction) {
      this.showTest = false; // Đóng test box khi mở work instruction
      this.showReport = false; // Đóng report khi mở work instruction
      this.showMatrixTraining = false; // Đóng matrix training khi mở work instruction
    }
  }

  toggleTest() {
    this.showTest = !this.showTest;
    if (this.showTest) {
      this.showWorkInstruction = false; // Đóng work instruction khi mở test
      this.showReport = false; // Đóng report khi mở test
      this.showMatrixTraining = false; // Đóng matrix training khi mở test
    }
  }

  toggleReport() {
    this.showReport = !this.showReport;
    if (this.showReport) {
      this.showWorkInstruction = false; // Đóng work instruction khi mở report
      this.showTest = false; // Đóng test khi mở report
      this.showMatrixTraining = false; // Đóng matrix training khi mở report
      this.refreshReportData(); // Force refresh data when opening report
    }
  }

  toggleMatrixTraining() {
    this.showMatrixTraining = !this.showMatrixTraining;
    if (this.showMatrixTraining) {
      this.showWorkInstruction = false; // Đóng work instruction khi mở matrix training
      this.showTest = false; // Đóng test khi mở matrix training
      this.showReport = false; // Đóng report khi mở matrix training
      this.cacheMatrixTrainingData(); // Cache data to improve performance
    }
  }

  closeAll() {
    this.showWorkInstruction = false;
    this.showTest = false;
    this.showReport = false;
    this.showMatrixTraining = false;
  }

  // Report methods
  async loadReportData() {
    this.isLoadingReport = true;
    try {
      this.reportData = await this.trainingReportService.getTrainingReports();
      this.filteredReportData = [...this.reportData];
      console.log(`📊 Loaded ${this.reportData.length} ASP employee training records from Firebase`);
      
      // Debug: Log signature status for each record
      this.reportData.forEach(record => {
        console.log(`👤 ${record.employeeId} (${record.name}): Signature = ${record.signature ? 'Available' : 'Not available'}`);
      });
      
      // Pre-cache matrix training data for better performance
      this.cacheMatrixTrainingData();
      
    } catch (error) {
      console.error('❌ Error loading report data:', error);
      // Fallback to empty array if Firebase fails
      this.reportData = [];
      this.filteredReportData = [];
      // Still cache matrix data with mock data
      this.cacheMatrixTrainingData();
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
          alert('Đã xóa bản ghi thành công!');
        } else {
          alert('Có lỗi xảy ra khi xóa bản ghi!');
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