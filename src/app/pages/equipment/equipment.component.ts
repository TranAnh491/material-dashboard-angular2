import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { TrainingReportService, TrainingRecord } from '../../services/training-report.service';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface FlowchartStep {
  vi: string;
  en: string;
  icon: string;
  type: 'material' | 'product';
  imageUrl?: string;
}



@Component({
  selector: 'app-equipment',
  templateUrl: './equipment.component.html',
  styleUrls: ['./equipment.component.css']
})
export class EquipmentComponent implements OnInit {

  isEnglish = false;
  selectedStep: FlowchartStep | null = null;
  showWorkInstruction = false;
  showTest = false;
  showReport = false;

  // Report properties
  reportData: TrainingRecord[] = [];
  filteredReportData: TrainingRecord[] = [];
  isLoadingReport = false;
  displayedColumns: string[] = ['employeeId', 'name', 'trainingContent', 'status', 'trainingDate', 'expiryDate', 'actions'];

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
    private trainingReportService: TrainingReportService
  ) { }

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

  toggleWorkInstruction() {
    this.showWorkInstruction = !this.showWorkInstruction;
    if (this.showWorkInstruction) {
      this.showTest = false; // Đóng test box khi mở work instruction
      this.showReport = false; // Đóng report khi mở work instruction
    }
  }

  toggleTest() {
    this.showTest = !this.showTest;
    if (this.showTest) {
      this.showWorkInstruction = false; // Đóng work instruction khi mở test
      this.showReport = false; // Đóng report khi mở test
    }
  }

  toggleReport() {
    this.showReport = !this.showReport;
    if (this.showReport) {
      this.showWorkInstruction = false; // Đóng work instruction khi mở report
      this.showTest = false; // Đóng test khi mở report
      this.refreshReportData(); // Force refresh data when opening report
    }
  }

  closeAll() {
    this.showWorkInstruction = false;
    this.showTest = false;
    this.showReport = false;
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
    } catch (error) {
      console.error('❌ Error loading report data:', error);
      // Fallback to empty array if Firebase fails
      this.reportData = [];
      this.filteredReportData = [];
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

    const confirmDelete = confirm(
      `Bạn có chắc chắn muốn xóa bản ghi đào tạo của nhân viên ${record.name} (${record.employeeId})?`
    );

    if (confirmDelete) {
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

      // Convert to canvas
      const canvas = await html2canvas(tempContainer, {
        width: 794,
        height: 1123,
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff'
      });

      // Remove temporary container
      document.body.removeChild(tempContainer);

      // Create PDF
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      const imgData = canvas.toDataURL('image/png');
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);

      // Save the PDF
      const fileName = `Bao_Cao_${record.employeeId}_${record.trainingDate.toLocaleDateString('vi-VN').replace(/\//g, '_')}.pdf`;
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
        <p style="margin: 0; font-size: 14px; color: #7f8c8d;">Mã tài liệu: ${fullRecord.documentCode || 'WH-WI0036(Ver00)'}</p>
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

      <div style="text-align: center; margin-top: 50px; font-size: 12px; color: #7f8c8d;">
        <p>Báo cáo được tạo từ hệ thống vào ${formatTime(new Date())} - ${formatDate(new Date())}</p>
        <p><strong>Trạng thái đào tạo:</strong> ${record.status === 'pass' ? 'Hợp lệ' : 'Cần đào tạo lại'}</p>
      </div>
    `;
  }
} 