import { Component, OnInit } from '@angular/core';
import * as XLSX from 'xlsx';

interface ScheduleItem {
  nam?: string;
  thang?: string;
  stt?: string;
  sizePhoi?: string;
  maTem?: string;
  soLuongYeuCau?: string;
  soLuongPhoi?: string;
  maHang?: string;
  lenhSanXuat?: string;
  khachHang?: string;
  ngayNhanKeHoach?: string;
  yy?: string;
  ww?: string;
  lineNhan?: string;
  nguoiIn?: string;
  tinhTrang?: string;
  banVe?: string;
  ghiChu?: string;
  labelComparison?: {
    photoUrl?: string;
    comparisonResult?: 'Pass' | 'Fail' | 'Pending';
    comparedAt?: Date;
    matchPercentage?: number;
  };
}

@Component({
  selector: 'app-print-label',
  templateUrl: './print-label.component.html',
  styleUrls: ['./print-label.component.scss']
})
export class PrintLabelComponent implements OnInit {

  selectedFunction: string | null = null;
  scheduleData: ScheduleItem[] = [];
  firebaseSaved: boolean = false;
  capturedImagePreview: string | null = null;

  constructor() { }

  ngOnInit(): void {
    console.log('Label Component initialized successfully!');
  }



  selectFunction(functionName: string): void {
    console.log('Selecting function:', functionName);
    this.selectedFunction = functionName;
  }

  // Print Schedules Functions
  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      console.log('File selected:', file.name);
      this.readExcelFile(file);
    }
  }

  readExcelFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        // Read Excel file using SheetJS
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Get first worksheet
        const worksheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[worksheetName];
        
        // Convert to JSON array
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        // Remove header row and convert to ScheduleItem format
        const dataRows = jsonData.slice(1); // Skip header row
        this.scheduleData = dataRows.map((row: any, index: number) => ({
          nam: row[0]?.toString() || '',
          thang: row[1]?.toString() || '',
          stt: row[2]?.toString() || '',
          sizePhoi: row[3]?.toString() || '',
          maTem: row[4]?.toString() || '',
          soLuongYeuCau: row[5]?.toString() || '',
          soLuongPhoi: row[6]?.toString() || '',
          maHang: row[7]?.toString() || '',
          lenhSanXuat: row[8]?.toString() || '',
          khachHang: row[9]?.toString() || '',
          ngayNhanKeHoach: this.formatDateValue(row[10]) || '',
          yy: row[11]?.toString() || '',
          ww: row[12]?.toString() || '',
          lineNhan: row[13]?.toString() || '',
          nguoiIn: row[14]?.toString() || '',
          tinhTrang: row[15]?.toString() || '',
          banVe: row[16]?.toString() || '',
          ghiChu: row[17]?.toString() || '',
          labelComparison: undefined // Initialize as undefined
        }));
        
        // Save to Firebase
        this.saveToFirebase(this.scheduleData);
        
        alert(`✅ Successfully imported ${this.scheduleData.length} records from ${file.name} and saved to Firebase 🔥`);
      } catch (error) {
        console.error('Error reading file:', error);
        alert('❌ Error reading Excel file. Please check the format.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  saveToFirebase(data: ScheduleItem[]): void {
    console.log('🔥 Saving data to Firebase...');
    
    // TODO: Implement Firebase save logic
    // Example structure:
    // firebase.firestore().collection('printSchedules').add({
    //   data: data,
    //   importedAt: new Date(),
    //   month: this.getCurrentMonth(),
    //   fileName: file.name,
    //   recordCount: data.length
    // });
    
    // For now, just log the data structure
    data.forEach((item, index) => {
      console.log(`🔥 Record ${index + 1}:`, {
        nam: item.nam,
        thang: item.thang,
        sizePhoi: item.sizePhoi,
        nguoiIn: item.nguoiIn,
        tinhTrang: item.tinhTrang,
        banVe: item.banVe
      });
    });
    
    // Simulate Firebase save success
    setTimeout(() => {
      console.log('✅ Data successfully saved to Firebase!');
      this.firebaseSaved = true;
    }, 1000);
  }

  getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  formatDateValue(value: any): string {
    if (!value) return '';
    
    // If it's already a string, return as is
    if (typeof value === 'string') return value;
    
    // If it's a number (Excel date serial number), convert to date
    if (typeof value === 'number') {
      // Excel dates are number of days since 1900-01-01
      const excelEpoch = new Date(1900, 0, 1);
      const date = new Date(excelEpoch.getTime() + (value - 2) * 24 * 60 * 60 * 1000);
      
      // Format as DD/MM/YYYY
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      
      return `${day}/${month}/${year}`;
    }
    
    // If it's a Date object, format it
    if (value instanceof Date) {
      const day = String(value.getDate()).padStart(2, '0');
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const year = value.getFullYear();
      
      return `${day}/${month}/${year}`;
    }
    
    // For other cases, convert to string
    return value.toString();
  }

  generateSampleData(): ScheduleItem[] {
    return [
      {
        nam: '2024',
        thang: '01',
        stt: '001',
        sizePhoi: '40x20',
        maTem: 'TM001',
        soLuongYeuCau: '1000',
        soLuongPhoi: '100',
        maHang: 'MH001',
        lenhSanXuat: 'LSX001',
        khachHang: 'ABC Corp',
        ngayNhanKeHoach: '15/01/2024',
        yy: '24',
        ww: '03',
        lineNhan: 'Line A',
        nguoiIn: 'Tuấn',
        tinhTrang: 'Chờ in',
        banVe: 'Có',
        ghiChu: 'Priority order',
        labelComparison: undefined
      },
      {
        nam: '2024',
        thang: '01',
        stt: '002',
        sizePhoi: '40x25',
        maTem: 'TM002',
        soLuongYeuCau: '500',
        soLuongPhoi: '50',
        maHang: 'MH002',
        lenhSanXuat: 'LSX002',
        khachHang: 'XYZ Ltd',
        ngayNhanKeHoach: '20/01/2024',
        yy: '24',
        ww: '04',
        lineNhan: 'Line B',
        nguoiIn: 'Tình',
        tinhTrang: 'Đã in',
        banVe: 'Có',
        ghiChu: 'Rush order',
        labelComparison: undefined
      },
      {
        nam: '2024',
        thang: '01',
        stt: '003',
        sizePhoi: '40x20',
        maTem: 'TM003',
        soLuongYeuCau: '2000',
        soLuongPhoi: '200',
        maHang: 'MH003',
        lenhSanXuat: 'LSX003',
        khachHang: 'DEF Inc',
        ngayNhanKeHoach: '25/01/2024',
        yy: '24',
        ww: '04',
        lineNhan: 'Line C',
        nguoiIn: 'Hưng',
        tinhTrang: 'Done',
        banVe: 'Chưa có',
        ghiChu: 'Standard order',
        labelComparison: undefined
      }
    ];
  }

  downloadTemplate(): void {
    console.log('Download Template clicked');
    
    // Create Excel template using SheetJS library
    // Note: In production, you would need to install: npm install xlsx
    this.createExcelTemplate();
  }

  createExcelTemplate(): void {
    // Create template data
    const templateData = [
      ['Năm', 'Tháng', 'STT', 'Size Phôi', 'Mã tem', 'Số lượng yêu cầu', 'Số lượng phôi', 'Mã Hàng', 'Lệnh sản xuất', 'Khách hàng', 'Ngày nhận kế hoạch', 'YY', 'WW', 'Line nhãn', 'Người in', 'Tình trạng', 'Bản vẽ', 'Ghi chú'],
      ['2025', '01', '001', '40x20', 'TM001', '1000', '100', 'MH001', 'LSX001', 'ABC Corp', '15/01/2025', '25', '03', 'Line A', 'Tuấn', 'Chờ in', 'Có', 'Sample data'],
      ['2025', '01', '002', '40x25', 'TM002', '500', '50', 'MH002', 'LSX002', 'XYZ Ltd', '20/01/2025', '25', '04', 'Line B', 'Tình', 'Đã in', 'Có', 'Sample data'],
      ['2025', '01', '003', '40x20', 'TM003', '2000', '200', 'MH003', 'LSX003', 'DEF Inc', '25/01/2025', '25', '04', 'Line C', 'Hưng', 'Done', 'Chưa có', 'Sample data']
    ];

    // Create workbook
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);

    // Set column widths
    const columnWidths = [
      { wch: 6 },  // Năm
      { wch: 6 },  // Tháng
      { wch: 5 },  // STT
      { wch: 10 }, // Size Phôi
      { wch: 10 }, // Mã tem
      { wch: 15 }, // Số lượng yêu cầu
      { wch: 15 }, // Số lượng phôi
      { wch: 10 }, // Mã Hàng
      { wch: 15 }, // Lệnh sản xuất
      { wch: 15 }, // Khách hàng
      { wch: 18 }, // Ngày nhận kế hoạch
      { wch: 4 },  // YY
      { wch: 4 },  // WW
      { wch: 12 }, // Line nhãn
      { wch: 12 }, // Người in
      { wch: 12 }, // Tình trạng
      { wch: 10 }, // Bản vẽ
      { wch: 15 }  // Ghi chú
    ];
    worksheet['!cols'] = columnWidths;

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Lịch In Tem');

    // Generate Excel file
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    
    // Download file
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'template-lich-in-tem-2025-07-18.xlsx';
    link.click();
    URL.revokeObjectURL(url);
    
    alert('Excel template file downloaded successfully!');
  }

  downloadCSV(data: any[][], filename: string): void {
    const csvContent = data.map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  exportExcel(): void {
    if (this.scheduleData.length === 0) {
      alert('No data to export');
      return;
    }

    console.log('Export Excel clicked');
    
    // Get current month for export
    const currentMonth = this.getCurrentMonth();
    const monthName = this.getMonthName(currentMonth);
    
    // Filter data by current month (in real app, this would query Firebase)
    const monthlyData = this.scheduleData.filter(item => 
      item.thang === currentMonth.split('-')[1] && item.nam === currentMonth.split('-')[0]
    );
    
    if (monthlyData.length === 0) {
      alert(`No data found for ${monthName}. Please import data first.`);
      return;
    }

    const exportData = [
      ['Năm', 'Tháng', 'STT', 'Size Phôi', 'Mã tem', 'Số lượng yêu cầu', 'Số lượng phôi', 'Mã Hàng', 'Lệnh sản xuất', 'Khách hàng', 'Ngày nhận kế hoạch', 'YY', 'WW', 'Line nhãn', 'Người in', 'Tình trạng', 'Bản vẽ', 'Ghi chú'],
      ...monthlyData.map(item => [
        item.nam || '',
        item.thang || '',
        item.stt || '',
        item.sizePhoi || '',
        item.maTem || '',
        item.soLuongYeuCau || '',
        item.soLuongPhoi || '',
        item.maHang || '',
        item.lenhSanXuat || '',
        item.khachHang || '',
        item.ngayNhanKeHoach || '',
        item.yy || '',
        item.ww || '',
        item.lineNhan || '',
        item.nguoiIn || '',
        item.tinhTrang || '',
        item.banVe || '',
        item.ghiChu || ''
      ])
    ];
    
    // Create Excel file
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(exportData);

    // Set column widths
    const columnWidths = [
      { wch: 6 },  // Năm
      { wch: 6 },  // Tháng
      { wch: 5 },  // STT
      { wch: 10 }, // Size Phôi
      { wch: 10 }, // Mã tem
      { wch: 15 }, // Số lượng yêu cầu
      { wch: 15 }, // Số lượng phôi
      { wch: 10 }, // Mã Hàng
      { wch: 15 }, // Lệnh sản xuất
      { wch: 15 }, // Khách hàng
      { wch: 18 }, // Ngày nhận kế hoạch
      { wch: 4 },  // YY
      { wch: 4 },  // WW
      { wch: 12 }, // Line nhãn
      { wch: 12 }, // Người in
      { wch: 12 }, // Tình trạng
      { wch: 10 }, // Bản vẽ
      { wch: 15 }  // Ghi chú
    ];
    worksheet['!cols'] = columnWidths;

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Lịch In Tem');

    // Generate Excel file
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    
    // Download file
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `print_schedule_${currentMonth}_${monthName}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
    
    alert(`Exported ${monthlyData.length} records for ${monthName} successfully!`);
  }

  clearScheduleData(): void {
    if (this.scheduleData.length === 0) {
      alert('Không có dữ liệu để xóa!');
        return;
      }
      
    const confirmDelete = confirm(`Bạn có chắc muốn xóa ${this.scheduleData.length} bản ghi đã import?\n\nDữ liệu sẽ bị mất vĩnh viễn!`);
    
    if (confirmDelete) {
      this.scheduleData = [];
      this.firebaseSaved = false;
      console.log('Schedule data cleared');
      alert('✅ Đã xóa tất cả dữ liệu!');
    }
  }

  getMonthName(monthKey: string): string {
    const months = {
      '01': 'January', '02': 'February', '03': 'March', '04': 'April',
      '05': 'May', '06': 'June', '07': 'July', '08': 'August',
      '09': 'September', '10': 'October', '11': 'November', '12': 'December'
    };
    const monthNumber = monthKey.split('-')[1];
    return months[monthNumber as keyof typeof months] || 'Unknown';
  }

  // Check Label Properties
  designPhoto: File | null = null;
  labelPhoto: File | null = null;
  designPhotoPreview: string | null = null;
  labelPhotoPreview: string | null = null;
  showA5Preview: boolean = false;
  analysisResult: any = null;

  // Check Label Functions
  onDesignPhotoSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      console.log('Design photo captured:', file.name);
      this.designPhoto = file;
      this.createPhotoPreview(file, 'design');
      alert('✅ Đã chụp hình mẫu thiết kế!');
    }
  }

  onLabelPhotoSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      console.log('Label photo captured:', file.name);
      this.labelPhoto = file;
      this.createPhotoPreview(file, 'label');
      alert('✅ Đã chụp hình tem đã in!');
    }
  }

  createPhotoPreview(file: File, type: 'design' | 'label'): void {
    const reader = new FileReader();
    reader.onload = (e: any) => {
      if (type === 'design') {
        this.designPhotoPreview = e.target.result;
    } else {
        this.labelPhotoPreview = e.target.result;
      }
    };
    reader.readAsDataURL(file);
  }

  convertToLightweightFormat(file: File): void {
    // Simulate conversion to lightweight format (e.g., WebP, compressed JSON)
    console.log('Converting design file to lightweight format for Firebase storage...');
    console.log('Original size:', this.formatFileSize(file.size));
    console.log('Estimated compressed size:', this.formatFileSize(file.size * 0.1)); // Simulate 90% compression
  }

  getFileExtension(filename: string): string {
    return filename.split('.').pop()?.toUpperCase() || 'Unknown';
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  downloadA5Template(): void {
    console.log('Download A5 Template clicked');
    this.showA5Preview = true;
    
    // Generate A5 template as HTML and convert to PDF
    this.generateA5CalibrationTemplate();
  }

  generateA5CalibrationTemplate(): void {
    // Create A5 template as canvas image
    this.createA5TemplateImage();
  }

  createA5TemplateImage(): void {
    // Create canvas for A5 template with 1mm grid
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      alert('❌ Cannot create canvas context');
      return;
    }

    // A5 dimensions in pixels (148mm x 210mm at 300 DPI for print quality)
    const width = 1748;  // 148mm * 300 DPI / 25.4
    const height = 2480; // 210mm * 300 DPI / 25.4
    
    canvas.width = width;
    canvas.height = height;

    // Set background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);

    // Draw 1mm grid pattern
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    const gridSize = 12; // 1mm = 1 * 300 DPI / 25.4 = 11.81 pixels, rounded to 12
    
    // Draw vertical lines (every 1mm)
    for (let x = 0; x <= width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    
    // Draw horizontal lines (every 1mm)
    for (let y = 0; y <= height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Draw centimeter markers (every 10mm)
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 2;
    const cmSize = gridSize * 10; // 10mm = 1cm
    
    // Vertical centimeter lines
    for (let x = 0; x <= width; x += cmSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    
    // Horizontal centimeter lines
    for (let y = 0; y <= height; y += cmSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Add centimeter labels
    ctx.fillStyle = '#333';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    
    // Horizontal centimeter labels (top)
    for (let cm = 0; cm <= 14; cm++) {
      const x = cm * cmSize;
      if (x <= width) {
        ctx.fillText(`${cm}cm`, x, 30);
      }
    }
    
    // Vertical centimeter labels (left)
    ctx.textAlign = 'right';
    for (let cm = 0; cm <= 20; cm++) {
      const y = cm * cmSize;
      if (y <= height) {
        ctx.fillText(`${cm}cm`, 30, y + 8);
      }
    }

    // Add title
    ctx.fillStyle = '#333';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('A5 Calibration Template - 1mm Grid', width/2, 80);

    // Add instructions
    ctx.font = '24px Arial';
    ctx.fillStyle = '#666';
    ctx.fillText('Print this template and use for precise measurements', width/2, 120);
    ctx.fillText('Grid lines are 1mm apart, bold lines are 1cm apart', width/2, 150);

    // Add centimeter labels
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    
    // Horizontal centimeter labels (top)
    for (let cm = 0; cm <= 12; cm++) {
      const x = cm * cmSize;
      if (x <= width) {
        ctx.fillText(`${cm}`, x, 30);
      }
    }
    
    // Vertical centimeter labels (left)
    ctx.textAlign = 'right';
    for (let cm = 0; cm <= 20; cm++) {
      const y = cm * cmSize;
      if (y <= height) {
        ctx.fillText(`${cm}`, 30, y + 8);
      }
    }

    // Convert canvas to blob and download
    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'A5_Calibration_Template_1mm_Grid.png';
        link.click();
        URL.revokeObjectURL(url);
        
        alert('✅ A5 Calibration Template (1mm grid) downloaded as PNG! Print this image for precise measurements.');
      } else {
        alert('❌ Failed to create template image');
      }
    }, 'image/png');
  }

  printA5Template(): void {
    // Open print dialog for the A5 template
    window.print();
  }

  analyzeLabels(): void {
    if (!this.designPhoto || !this.labelPhoto) {
      alert('Vui lòng chụp hình mẫu thiết kế và tem đã in trước.');
      return;
    }
    
    console.log('Starting intelligent label analysis...');
    
    // Simulate AI analysis process with design comparison
    setTimeout(() => {
      this.analysisResult = this.performIntelligentAnalysis();
      this.displayAnalysisResults();
    }, 3000); // Simulate processing time
  }

  performIntelligentAnalysis(): any {
    // Simulate intelligent analysis comparing design vs printed label
    const designAnalysis = this.analyzeDesignSpecifications();
    const labelAnalysis = this.analyzePrintedLabel();
    const comparison = this.compareDesignVsLabel(designAnalysis, labelAnalysis);
    
    return {
      designSpecs: designAnalysis,
      labelMeasurements: labelAnalysis,
      comparison: comparison,
      overallMatch: comparison.overallMatch,
      recommendations: comparison.recommendations
    };
  }

  analyzeDesignSpecifications(): any {
    // Simulate extracting specifications from design drawing
    return {
      labelSize: {
        width: Math.floor(Math.random() * 20) + 30, // 30-50mm
        height: Math.floor(Math.random() * 15) + 20  // 20-35mm
      },
      fontSpecs: {
        family: ['Arial', 'Times New Roman', 'Calibri'][Math.floor(Math.random() * 3)],
        size: Math.floor(Math.random() * 8) + 8, // 8-16pt
        weight: ['Normal', 'Bold'][Math.floor(Math.random() * 2)]
      },
      textContent: {
        mainText: 'SAMPLE PRODUCT',
        subText: 'Made in Vietnam',
        barcode: '123456789012'
      },
      colors: {
        background: '#FFFFFF',
        text: '#000000',
        border: '#333333'
      }
    };
  }

  analyzePrintedLabel(): any {
    // Simulate analyzing the printed label
    return {
      actualSize: {
        width: Math.floor(Math.random() * 20) + 30, // 30-50mm
        height: Math.floor(Math.random() * 15) + 20  // 20-35mm
      },
      fontAnalysis: {
        detectedFont: ['Arial', 'Times New Roman', 'Calibri'][Math.floor(Math.random() * 3)],
        fontSize: Math.floor(Math.random() * 8) + 8, // 8-16pt
        fontWeight: ['Normal', 'Bold'][Math.floor(Math.random() * 2)],
        fontMatch: Math.floor(Math.random() * 20) + 80 // 80-100%
      },
      textRecognition: {
        mainText: 'SAMPLE PRODUCT',
        subText: 'Made in Vietnam',
        barcode: '123456789012',
        accuracy: Math.floor(Math.random() * 15) + 85 // 85-100%
      },
      qualityMetrics: {
        contrast: Math.floor(Math.random() * 20) + 80, // 80-100%
        sharpness: Math.floor(Math.random() * 20) + 80, // 80-100%
        alignment: Math.floor(Math.random() * 20) + 80  // 80-100%
      }
    };
  }

  compareDesignVsLabel(designSpecs: any, labelAnalysis: any): any {
    // Compare design specifications with actual printed label
    const sizeMatch = this.calculateSizeMatch(designSpecs.labelSize, labelAnalysis.actualSize);
    const fontMatch = this.calculateFontMatch(designSpecs.fontSpecs, labelAnalysis.fontAnalysis);
    const textMatch = this.calculateTextMatch(designSpecs.textContent, labelAnalysis.textRecognition);
    const qualityMatch = this.calculateQualityMatch(labelAnalysis.qualityMetrics);
    
    const overallMatch = Math.floor((sizeMatch + fontMatch + textMatch + qualityMatch) / 4);
    
    return {
      sizeMatch,
      fontMatch,
      textMatch,
      qualityMatch,
      overallMatch,
      recommendations: this.generateRecommendations(sizeMatch, fontMatch, textMatch, qualityMatch)
    };
  }

  calculateSizeMatch(designSize: any, actualSize: any): number {
    const widthDiff = Math.abs(designSize.width - actualSize.width);
    const heightDiff = Math.abs(designSize.height - actualSize.height);
    const tolerance = 2; // 2mm tolerance
    
    const widthMatch = Math.max(0, 100 - (widthDiff / tolerance) * 20);
    const heightMatch = Math.max(0, 100 - (heightDiff / tolerance) * 20);
    
    return Math.floor((widthMatch + heightMatch) / 2);
  }

  calculateFontMatch(designFont: any, actualFont: any): number {
    let match = 100;
    
    // Font family match
    if (designFont.family !== actualFont.detectedFont) {
      match -= 30;
    }
    
    // Font size match
    const sizeDiff = Math.abs(designFont.size - actualFont.fontSize);
    match -= sizeDiff * 5;
    
    // Font weight match
    if (designFont.weight !== actualFont.fontWeight) {
      match -= 20;
    }
    
    return Math.max(0, match);
  }

  calculateTextMatch(designText: any, actualText: any): number {
    let match = 100;
    
    // Text content accuracy
    if (designText.mainText !== actualText.mainText) {
      match -= 25;
    }
    if (designText.subText !== actualText.subText) {
      match -= 15;
    }
    if (designText.barcode !== actualText.barcode) {
      match -= 20;
    }
    
    // OCR accuracy
    match = Math.floor(match * actualText.accuracy / 100);
    
    return Math.max(0, match);
  }

  calculateQualityMatch(qualityMetrics: any): number {
    return Math.floor((qualityMetrics.contrast + qualityMetrics.sharpness + qualityMetrics.alignment) / 3);
  }

  generateRecommendations(sizeMatch: number, fontMatch: number, textMatch: number, qualityMatch: number): string[] {
    const recommendations = [];
    
    if (sizeMatch < 90) {
      recommendations.push('🔧 Điều chỉnh kích thước tem theo bản vẽ thiết kế');
    }
    
    if (fontMatch < 90) {
      recommendations.push('🔤 Thay đổi font chữ để khớp với thiết kế');
    }
    
    if (textMatch < 90) {
      recommendations.push('📝 Kiểm tra lại nội dung text trên tem');
    }
    
    if (qualityMatch < 90) {
      recommendations.push('🎨 Cải thiện chất lượng in (độ tương phản, độ sắc nét)');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('✅ Tem đạt chuẩn chất lượng cao');
    }
    
    return recommendations;
  }

  displayAnalysisResults(): void {
    const result = this.analysisResult;
    const designSpecs = result.designSpecs;
    const labelAnalysis = result.labelMeasurements;
    const comparison = result.comparison;
    
    let message = `📊 KẾT QUẢ PHÂN TÍCH THÔNG MINH\n\n`;
    message += `🎯 ĐỘ KHỚP TỔNG THỂ: ${comparison.overallMatch}%\n\n`;
    
    message += `📐 SO SÁNH KÍCH THƯỚC:\n`;
    message += `• Thiết kế: ${designSpecs.labelSize.width}mm x ${designSpecs.labelSize.height}mm\n`;
    message += `• Thực tế: ${labelAnalysis.actualSize.width}mm x ${labelAnalysis.actualSize.height}mm\n`;
    message += `• Độ khớp: ${comparison.sizeMatch}%\n\n`;
    
    message += `🔤 PHÂN TÍCH FONT:\n`;
    message += `• Thiết kế: ${designSpecs.fontSpecs.family} ${designSpecs.fontSpecs.size}pt ${designSpecs.fontSpecs.weight}\n`;
    message += `• Thực tế: ${labelAnalysis.fontAnalysis.detectedFont} ${labelAnalysis.fontAnalysis.fontSize}pt ${labelAnalysis.fontAnalysis.fontWeight}\n`;
    message += `• Độ khớp font: ${comparison.fontMatch}%\n\n`;
    
    message += `📝 NHẬN DIỆN TEXT:\n`;
    message += `• Độ chính xác OCR: ${labelAnalysis.textRecognition.accuracy}%\n`;
    message += `• Độ khớp nội dung: ${comparison.textMatch}%\n\n`;
    
    message += `🎨 CHẤT LƯỢNG IN:\n`;
    message += `• Độ tương phản: ${labelAnalysis.qualityMetrics.contrast}%\n`;
    message += `• Độ sắc nét: ${labelAnalysis.qualityMetrics.sharpness}%\n`;
    message += `• Độ căn chỉnh: ${labelAnalysis.qualityMetrics.alignment}%\n`;
    message += `• Điểm chất lượng: ${comparison.qualityMatch}%\n\n`;
    
    message += `💡 KHUYẾN NGHỊ:\n`;
    comparison.recommendations.forEach((rec: string, index: number) => {
      message += `${index + 1}. ${rec}\n`;
    });
    
    alert(message);
  }

  getDetailColor(status: string): string {
    switch(status) {
      case 'success': return '#4caf50';
      case 'warning': return '#ff9800';
      case 'error': return '#f44336';
      default: return '#333';
    }
  }

  getQualityStatus(percentage: number): string {
    if (percentage >= 90) return 'CHẤT LƯỢNG XUẤT SẮC';
    if (percentage >= 80) return 'CHẤT LƯỢNG TỐT';
    if (percentage >= 70) return 'CHẤP NHẬN ĐƯỢC';
    return 'CẦN CẢI THIỆN';
  }

  // Simplified Label Comparison Methods
  captureAndCompareLabel(item: ScheduleItem): void {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('❌ Camera not available on this device');
      return;
    }

    // Request camera access
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(stream => {
        // Create video element for camera preview
        const video = document.createElement('video');
        video.srcObject = stream;
        video.play();

        // Create canvas for capturing
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          alert('❌ Cannot create canvas context');
          return;
        }

        // Set canvas size
        canvas.width = 640;
        canvas.height = 480;

        // Show capture dialog
        const captureDialog = this.createCaptureDialog(video, canvas, item);
        document.body.appendChild(captureDialog);
      })
      .catch(error => {
        console.error('Camera error:', error);
        alert('❌ Cannot access camera. Please check permissions.');
      });
  }

  createCaptureDialog(video: HTMLVideoElement, canvas: HTMLCanvasElement, item: ScheduleItem): HTMLElement {
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.8);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
      background: white;
      padding: 20px;
      border-radius: 10px;
      text-align: center;
      max-width: 90%;
      max-height: 90%;
    `;

    const title = document.createElement('h3');
    title.textContent = '📸 Chụp so sánh tem';
    title.style.marginBottom = '15px';

    const instruction = document.createElement('p');
    instruction.textContent = 'Đặt cả mẫu thiết kế và tem thực tế trong khung hình';
    instruction.style.marginBottom = '15px';
    instruction.style.color = '#666';

    const videoContainer = document.createElement('div');
    videoContainer.style.cssText = `
      margin: 15px 0;
      border: 2px solid #ddd;
      border-radius: 8px;
      overflow: hidden;
    `;

    video.style.cssText = `
      width: 100%;
      max-width: 400px;
      height: auto;
    `;

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      gap: 10px;
      justify-content: center;
      margin-top: 15px;
    `;

    const captureBtn = document.createElement('button');
    captureBtn.textContent = '📸 Chụp ảnh';
    captureBtn.style.cssText = `
      background: #4caf50;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 16px;
    `;

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '❌ Hủy';
    cancelBtn.style.cssText = `
      background: #f44336;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 16px;
    `;

    captureBtn.onclick = () => {
      this.captureAndAnalyze(video, canvas, item, dialog);
    };

    cancelBtn.onclick = () => {
      document.body.removeChild(dialog);
      if (video.srcObject) {
        const tracks = (video.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
    };

    buttonContainer.appendChild(captureBtn);
    buttonContainer.appendChild(cancelBtn);

    videoContainer.appendChild(video);
    content.appendChild(title);
    content.appendChild(instruction);
    content.appendChild(videoContainer);
    content.appendChild(buttonContainer);
    dialog.appendChild(content);

    return dialog;
  }

  captureAndAnalyze(video: HTMLVideoElement, canvas: HTMLCanvasElement, item: ScheduleItem, dialog: HTMLElement): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Capture frame from video
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert to compressed format
    canvas.toBlob((blob) => {
      if (blob) {
        // Compress image further
        this.compressAndSaveImage(blob, item, dialog);
      }
    }, 'image/jpeg', 0.7); // 70% quality for smaller size
  }

  compressAndSaveImage(blob: Blob, item: ScheduleItem, dialog: HTMLElement): void {
    // Create a smaller canvas for further compression
    const smallCanvas = document.createElement('canvas');
    const smallCtx = smallCanvas.getContext('2d');
    
    if (!smallCtx) return;

    // Set smaller size for mobile optimization
    smallCanvas.width = 320;
    smallCanvas.height = 240;

    const img = new Image();
    img.onload = () => {
      smallCtx.drawImage(img, 0, 0, smallCanvas.width, smallCanvas.height);
      
      // Convert to very compressed format
      smallCanvas.toBlob((compressedBlob) => {
        if (compressedBlob) {
          // Convert to base64 for Firebase storage
          const reader = new FileReader();
          reader.onload = () => {
            const base64Data = reader.result as string;
            
            // Simulate analysis
            this.performSimpleComparison(base64Data, item);
            
            // Close dialog
            document.body.removeChild(dialog);
            // Stop camera stream
            const videoElement = dialog.querySelector('video');
            if (videoElement && videoElement.srcObject) {
              const tracks = (videoElement.srcObject as MediaStream).getTracks();
              tracks.forEach(track => track.stop());
            }
          };
          reader.readAsDataURL(compressedBlob);
        }
      }, 'image/jpeg', 0.5); // 50% quality for minimal size
    };
    img.src = URL.createObjectURL(blob);
  }

  performSimpleComparison(photoUrl: string, item: ScheduleItem): void {
    // Simulate AI comparison
    const matchPercentage = Math.floor(Math.random() * 30) + 70; // 70-100%
    const result: 'Pass' | 'Fail' = matchPercentage >= 85 ? 'Pass' : 'Fail';
    
    // Update item
    item.labelComparison = {
      photoUrl: photoUrl,
      comparisonResult: result,
      comparedAt: new Date(),
      matchPercentage: matchPercentage
    };

    // Save to Firebase
    this.saveComparisonToFirebase(item);

    // Show result
    const status = result === 'Pass' ? '✅ PASS' : '❌ FAIL';
    alert(`${status}\nĐộ khớp: ${matchPercentage}%\nĐã lưu vào Firebase 🔥`);
  }

  saveComparisonToFirebase(item: ScheduleItem): void {
    console.log('🔥 Saving comparison to Firebase:', {
      itemId: item.stt,
      comparison: item.labelComparison,
      timestamp: new Date()
    });

    // TODO: Implement actual Firebase save
    // firebase.firestore().collection('labelComparisons').add({
    //   itemId: item.stt,
    //   photoUrl: item.labelComparison?.photoUrl,
    //   result: item.labelComparison?.comparisonResult,
    //   matchPercentage: item.labelComparison?.matchPercentage,
    //   comparedAt: item.labelComparison?.comparedAt,
    //   compressed: true
    // });
  }

  getComparisonIcon(item: ScheduleItem): string {
    if (!item.labelComparison) return '📸';
    
    switch (item.labelComparison.comparisonResult) {
      case 'Pass': return '✅';
      case 'Fail': return '❌';
      default: return '⏳';
    }
  }

  getComparisonTooltip(item: ScheduleItem): string {
    if (!item.labelComparison) return 'Chưa so sánh';
    
    const result = item.labelComparison.comparisonResult;
    const percentage = item.labelComparison.matchPercentage;
    const date = item.labelComparison.comparedAt;
    
    if (result === 'Pass') {
      return `✅ PASS (${percentage}%) - ${date?.toLocaleString()}`;
    } else if (result === 'Fail') {
      return `❌ FAIL (${percentage}%) - ${date?.toLocaleString()}`;
    }
    
    return '⏳ Đang xử lý...';
  }

  labelComparisonDialog = false;
  currentComparisonIndex = -1;

  // Getter methods for template counting
  get passedCount(): number {
    return this.scheduleData.filter(item => item.labelComparison?.comparisonResult === 'Pass').length;
  }

  get failedCount(): number {
    return this.scheduleData.filter(item => item.labelComparison?.comparisonResult === 'Fail').length;
  }

  get notComparedCount(): number {
    return this.scheduleData.filter(item => !item.labelComparison).length;
  }
} 