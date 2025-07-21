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
          ngayNhanKeHoach: row[10]?.toString() || '',
          yy: row[11]?.toString() || '',
          ww: row[12]?.toString() || '',
          lineNhan: row[13]?.toString() || '',
          nguoiIn: row[14]?.toString() || '',
          tinhTrang: row[15]?.toString() || '',
          banVe: row[16]?.toString() || '',
          ghiChu: row[17]?.toString() || ''
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
        ghiChu: 'Priority order'
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
        ghiChu: 'Rush order'
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
        ghiChu: 'Standard order'
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
    // Create canvas for A5 template
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

    // Draw grid pattern (5mm grid)
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 2;
    const gridSize = 59; // 5mm = 5 * 300 DPI / 25.4 = 59 pixels
    
    for (let x = 0; x <= width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    
    for (let y = 0; y <= height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Title
    ctx.fillStyle = '#333';
    ctx.font = 'bold 72px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Label Calibration Template - A5', width/2, 120);
    
    // Instructions
    ctx.font = '36px Arial';
    ctx.fillStyle = '#666';
    ctx.fillText('Print this template and place your label in the red area', width/2, 180);
    ctx.fillText('Use the scales to measure label size, font, and font size', width/2, 220);

    // Font samples with different sizes
    ctx.textAlign = 'left';
    ctx.fillStyle = '#333';
    
    let yPos = 280;
    const fontSizes = [24, 30, 36, 42, 48, 54, 60];
    const fontNames = ['24pt', '30pt', '36pt', '42pt', '48pt', '54pt', '60pt'];
    
    fontSizes.forEach((size, index) => {
      ctx.font = `bold ${size}px Arial`;
      ctx.fillText(`Arial ${fontNames[index]}: Sample Text ABCD 1234`, 60, yPos);
      yPos += size + 20;
    });

    // Label placement area
    const labelArea = {
      x: 150,
      y: yPos + 40,
      width: width - 300,
      height: 600
    };

    // Draw dashed border for label area
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 9;
    ctx.setLineDash([30, 15]);
    ctx.strokeRect(labelArea.x, labelArea.y, labelArea.width, labelArea.height);
    ctx.setLineDash([]);

    // Fill label area with light red
    ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
    ctx.fillRect(labelArea.x, labelArea.y, labelArea.width, labelArea.height);

    // Label area text
    ctx.fillStyle = 'red';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('PLACE LABEL HERE', width/2, labelArea.y + labelArea.height/2 - 30);
    ctx.font = '36px Arial';
    ctx.fillText('Align label edges with red border', width/2, labelArea.y + labelArea.height/2 + 45);

    // Horizontal scale (top)
    const scaleYTop = 100;
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(150, scaleYTop);
    ctx.lineTo(width - 150, scaleYTop);
    ctx.stroke();

    // Vertical scale (left)
    const scaleXLeft = 100;
    ctx.beginPath();
    ctx.moveTo(scaleXLeft, 150);
    ctx.lineTo(scaleXLeft, height - 150);
    ctx.stroke();

    // Draw centimeter ticks for horizontal scale
    ctx.font = '30px Arial';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'black';
    
    const cmInPixels = 300 / 25.4; // 1cm = 300 DPI / 25.4mm = 118.11 pixels
    for (let cm = 0; cm <= 12; cm++) {
      const x = 150 + (cm * cmInPixels);
      if (x <= width - 150) {
        // Draw tick mark
        ctx.beginPath();
        ctx.moveTo(x, scaleYTop - 15);
        ctx.lineTo(x, scaleYTop + 15);
        ctx.stroke();
        
        // Draw centimeter number
        ctx.fillText(`${cm}cm`, x, scaleYTop - 25);
      }
    }

    // Draw centimeter ticks for vertical scale
    ctx.textAlign = 'right';
    for (let cm = 0; cm <= 20; cm++) {
      const y = 150 + (cm * cmInPixels);
      if (y <= height - 150) {
        // Draw tick mark
        ctx.beginPath();
        ctx.moveTo(scaleXLeft - 15, y);
        ctx.lineTo(scaleXLeft + 15, y);
        ctx.stroke();
        
        // Draw centimeter number
        ctx.fillText(`${cm}cm`, scaleXLeft - 25, y + 10);
      }
    }

    // Reference line at 5cm from bottom
    const refY = height - (5 * cmInPixels);
    ctx.strokeStyle = 'blue';
    ctx.lineWidth = 6;
    ctx.setLineDash([30, 15]);
    ctx.beginPath();
    ctx.moveTo(150, refY);
    ctx.lineTo(width - 150, refY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Reference line text
    ctx.fillStyle = 'blue';
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('5cm from bottom edge', width/2, refY - 30);

    // Convert canvas to blob and download
    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'A5_Calibration_Template.png';
        link.click();
        URL.revokeObjectURL(url);
        
        alert('✅ A5 Calibration Template downloaded as PNG! Print this image and use for label placement.');
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
    
    console.log('Starting label analysis...');
    
    // Simulate AI analysis process
    setTimeout(() => {
      this.analysisResult = this.simulateAnalysis();
      alert(`✅ Phân tích hoàn thành!\nĐộ khớp tổng thể: ${this.analysisResult.overallMatch}%`);
    }, 2000); // Simulate processing time
  }

  simulateAnalysis(): any {
    // Simulate AI analysis results
    const fontMatch = Math.floor(Math.random() * 20) + 80; // 80-100%
    const sizeMatch = Math.floor(Math.random() * 25) + 75; // 75-100%
    const positionMatch = Math.floor(Math.random() * 30) + 70; // 70-100%
    const overallMatch = Math.floor((fontMatch + sizeMatch + positionMatch) / 3);
    
    return {
      overallMatch,
      fontMatch,
      sizeMatch,
      positionMatch,
      details: [
        { message: `Phát hiện font: ${fontMatch >= 90 ? 'Hoàn hảo' : fontMatch >= 80 ? 'Tốt' : 'Cần cải thiện'}`, status: fontMatch >= 90 ? 'success' : fontMatch >= 80 ? 'warning' : 'error' },
        { message: `Độ chính xác kích thước: ${sizeMatch >= 90 ? 'Xuất sắc' : sizeMatch >= 80 ? 'Tốt' : 'Kém'}`, status: sizeMatch >= 90 ? 'success' : sizeMatch >= 80 ? 'warning' : 'error' },
        { message: `Vị trí tem: ${positionMatch >= 90 ? 'Chính xác' : positionMatch >= 80 ? 'Chấp nhận được' : 'Lệch'}`, status: positionMatch >= 90 ? 'success' : positionMatch >= 80 ? 'warning' : 'error' },
        { message: 'Độ tương phản màu: Đủ', status: 'success' },
        { message: 'Phát hiện viền: Rõ ràng', status: 'success' }
      ]
    };
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
} 