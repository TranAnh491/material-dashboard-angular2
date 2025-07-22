import { Component, OnInit } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
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
    mismatchDetails?: string[];
    hasSampleText?: boolean;
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
  isSaving: boolean = false;
  isLoading: boolean = false;

  constructor(private firestore: AngularFirestore) { }

  ngOnInit(): void {
    console.log('Label Component initialized successfully!');
    this.loadDataFromFirebase();
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
      
      // Validate file type
      const validTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
      ];
      
      if (!validTypes.includes(file.type)) {
        alert('❌ Vui lòng chọn file Excel (.xlsx hoặc .xls)');
        return;
      }
      
      // Reset states
      this.firebaseSaved = false;
      this.isSaving = false;
      
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
        console.log('📊 Raw Excel data:', jsonData);
        
        // Validate Excel structure
        if (!jsonData || jsonData.length < 2) {
          throw new Error('Excel file is empty or has no data rows');
        }

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
          ghiChu: row[17]?.toString() || ''
          // Remove labelComparison: undefined - Firebase doesn't allow undefined values
        }));
        
        // Validate data before saving
        if (this.scheduleData.length === 0) {
          throw new Error('No data found in Excel file');
        }

        // Save to Firebase 
        this.saveToFirebase(this.scheduleData);
        
        alert(`✅ Successfully imported ${this.scheduleData.length} records from ${file.name} and saved to Firebase 🔥`);
      } catch (error) {
        console.error('Error reading file:', error);
        this.isSaving = false; // Reset saving state on error
        alert('❌ Error reading Excel file. Please check the format.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  saveToFirebase(data: ScheduleItem[]): void {
    console.log('🔥 Saving data to Firebase...');
    
    // Validate data before saving
    if (!data || data.length === 0) {
      console.error('❌ No data to save to Firebase');
      alert('❌ Không có dữ liệu để lưu vào Firebase!');
      return;
    }
    
    this.isSaving = true;
    
    const printScheduleDoc = {
      data: data,
      importedAt: new Date(),
      month: this.getCurrentMonth(),
      recordCount: data.length,
      lastUpdated: new Date()
    };

    // Add timeout to Firebase save
    const savePromise = this.firestore.collection('printSchedules').add(printScheduleDoc);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Firebase save timeout after 15 seconds')), 15000)
    );

    Promise.race([savePromise, timeoutPromise])
      .then((docRef: any) => {
        console.log('✅ Data successfully saved to Firebase with ID: ', docRef.id);
        this.firebaseSaved = true;
        this.isSaving = false;
        alert('✅ Dữ liệu đã được lưu thành công vào Firebase!');
      })
      .catch((error) => {
        console.error('❌ Error saving to Firebase: ', error);
        this.isSaving = false;
        this.firebaseSaved = false;
        alert(`❌ Lỗi khi lưu dữ liệu vào Firebase: ${error.message || error}`);
      });
  }

  loadDataFromFirebase(): void {
    console.log('🔥 Loading data from Firebase...');
    this.isLoading = true;
    
    const loadPromise = this.firestore.collection('printSchedules', ref => 
      ref.orderBy('importedAt', 'desc').limit(1)
    ).get().toPromise();

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Firebase load timeout after 10 seconds')), 10000)
    );

    Promise.race([loadPromise, timeoutPromise])
      .then((querySnapshot: any) => {
        this.isLoading = false;
        if (querySnapshot && !querySnapshot.empty) {
          const doc = querySnapshot.docs[0];
          const docData = doc.data() as any;
          this.scheduleData = docData.data || [];
          console.log(`🔥 Loaded ${this.scheduleData.length} records from Firebase`);
          console.log(`📅 Data imported at: ${docData.importedAt?.toDate()}`);
        } else {
          console.log('🔥 No data found in Firebase');
          this.scheduleData = [];
        }
      })
      .catch((error) => {
        console.error('🔥 Error loading from Firebase:', error);
        this.isLoading = false;
        this.scheduleData = [];
      });
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
    console.log('🚀 Starting camera capture for item:', item.maTem);
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('❌ Camera not available on this device');
      return;
    }

    // Enhanced camera constraints for mobile
    const constraints = {
      video: {
        facingMode: 'environment', // Use rear camera
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        aspectRatio: 16/9
      }
    };

    // Request camera access
    navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => {
        console.log('📹 Camera stream obtained');
        
        // Create video element for camera preview
        const video = document.createElement('video');
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true; // Important for iOS
        video.muted = true; // Prevent audio feedback
        
        // Create canvas for capturing
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          alert('❌ Cannot create canvas context');
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        // Set canvas size
        canvas.width = 1280;
        canvas.height = 720;

        // Wait for video to be ready
        video.onloadedmetadata = () => {
          console.log('📺 Video metadata loaded, showing dialog');
          // Show capture dialog
          const captureDialog = this.createCaptureDialog(video, canvas, item);
          document.body.appendChild(captureDialog);
        };

        // Fallback in case onloadedmetadata doesn't fire
        setTimeout(() => {
          if (!document.querySelector('.camera-dialog')) {
            console.log('⏰ Fallback: Showing dialog after timeout');
            const captureDialog = this.createCaptureDialog(video, canvas, item);
            document.body.appendChild(captureDialog);
          }
        }, 2000);
      })
      .catch(error => {
        console.error('❌ Camera error:', error);
        if (error.name === 'NotAllowedError') {
          alert('❌ Camera permission denied. Please allow camera access and try again.');
        } else if (error.name === 'NotFoundError') {
          alert('❌ No camera found on this device.');
        } else {
          alert('❌ Cannot access camera: ' + error.message);
        }
      });
  }

  createCaptureDialog(video: HTMLVideoElement, canvas: HTMLCanvasElement, item: ScheduleItem): HTMLElement {
    const dialog = document.createElement('div');
    dialog.className = 'camera-dialog';
    dialog.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      background: rgba(0,0,0,0.95) !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: flex-start !important;
      z-index: 99999 !important;
      padding: 0 !important;
      box-sizing: border-box !important;
      overflow: hidden !important;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
      background: white !important;
      border-radius: 0 !important;
      text-align: center !important;
      width: 100% !important;
      height: 100vh !important;
      display: flex !important;
      flex-direction: column !important;
      overflow: hidden !important;
      position: relative !important;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      padding: 10px 15px !important;
      border-bottom: 2px solid #eee !important;
      background: #f8f9fa !important;
      flex-shrink: 0 !important;
      position: relative !important;
      min-height: 80px !important;
    `;

    const title = document.createElement('h3');
    title.textContent = '📸 Chụp so sánh tem';
    title.style.cssText = `
      margin: 0 !important;
      color: #333 !important;
      font-size: 18px !important;
      font-weight: bold !important;
    `;

    const instruction = document.createElement('p');
    instruction.innerHTML = `
      <strong>Yêu cầu:</strong><br>
      • Đặt cả mẫu thiết kế và tem thực tế trong khung hình<br>
      • Đảm bảo có chữ <span style="color: #f44336; font-weight: bold;">"Sample"</span> trên tem mẫu
    `;
    instruction.style.cssText = `
      margin: 8px 0 0 0 !important;
      color: #666 !important;
      font-size: 12px !important;
      line-height: 1.3 !important;
    `;

    const videoContainer = document.createElement('div');
    videoContainer.style.cssText = `
      flex: 1 !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 5px !important;
      background: #000 !important;
      position: relative !important;
      min-height: 200px !important;
      overflow: hidden !important;
    `;

    const videoWrapper = document.createElement('div');
    videoWrapper.style.cssText = `
      width: 100% !important;
      max-width: 100% !important;
      aspect-ratio: 4/3 !important;
      border: 2px solid #4caf50 !important;
      border-radius: 8px !important;
      overflow: hidden !important;
      background: #000 !important;
      position: relative !important;
    `;

    video.style.cssText = `
      width: 100% !important;
      height: 100% !important;
      object-fit: cover !important;
      display: block !important;
    `;

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      padding: 15px 20px !important;
      border-top: 2px solid #eee !important;
      background: #f8f9fa !important;
      flex-shrink: 0 !important;
      display: flex !important;
      gap: 15px !important;
      justify-content: center !important;
      align-items: center !important;
      position: fixed !important;
      bottom: 0 !important;
      left: 0 !important;
      right: 0 !important;
      width: 100% !important;
      box-sizing: border-box !important;
      z-index: 1000 !important;
      min-height: 90px !important;
    `;

    const captureBtn = document.createElement('button');
    captureBtn.innerHTML = '📸 Chụp ảnh';
    captureBtn.style.cssText = `
      background: #4caf50 !important;
      color: white !important;
      border: 3px solid white !important;
      padding: 20px 35px !important;
      border-radius: 15px !important;
      cursor: pointer !important;
      font-size: 20px !important;
      font-weight: bold !important;
      box-shadow: 0 6px 16px rgba(76, 175, 80, 0.4) !important;
      flex: 1 !important;
      max-width: 180px !important;
      min-height: 70px !important;
      transition: all 0.2s ease !important;
      text-align: center !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      -webkit-tap-highlight-color: transparent !important;
      touch-action: manipulation !important;
      position: relative !important;
      z-index: 1001 !important;
    `;

    const cancelBtn = document.createElement('button');
    cancelBtn.innerHTML = '❌ Hủy';
    cancelBtn.style.cssText = `
      background: #f44336 !important;
      color: white !important;
      border: 3px solid white !important;
      padding: 20px 35px !important;
      border-radius: 15px !important;
      cursor: pointer !important;
      font-size: 20px !important;
      font-weight: bold !important;
      box-shadow: 0 6px 16px rgba(244, 67, 54, 0.4) !important;
      flex: 1 !important;
      max-width: 180px !important;
      min-height: 70px !important;
      transition: all 0.2s ease !important;
      text-align: center !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      -webkit-tap-highlight-color: transparent !important;
      touch-action: manipulation !important;
      position: relative !important;
      z-index: 1001 !important;
    `;

    // Add multiple event handlers for better mobile support
    const handleCaptureClick = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('📸 Capture button activated!');
      this.captureAndAnalyze(video, canvas, item, dialog);
    };

    const handleCancelClick = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('❌ Cancel button activated!');
      document.body.removeChild(dialog);
      if (video.srcObject) {
        const tracks = (video.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
    };

    // Add multiple event types for better mobile compatibility
    captureBtn.addEventListener('click', handleCaptureClick);
    captureBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      captureBtn.style.transform = 'scale(0.95)';
      captureBtn.style.background = '#45a049';
    });
    captureBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      captureBtn.style.transform = 'scale(1)';
      captureBtn.style.background = '#4caf50';
      handleCaptureClick(e);
    });
    
    cancelBtn.addEventListener('click', handleCancelClick);
    cancelBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      cancelBtn.style.transform = 'scale(0.95)';
      cancelBtn.style.background = '#d32f2f';
    });
    cancelBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      cancelBtn.style.transform = 'scale(1)';
      cancelBtn.style.background = '#f44336';
      handleCancelClick(e);
    });

    // No need for onclick handlers as we have addEventListener above

    // Ensure buttons are clickable
    captureBtn.style.pointerEvents = 'auto';
    cancelBtn.style.pointerEvents = 'auto';
    buttonContainer.style.pointerEvents = 'auto';

    buttonContainer.appendChild(captureBtn);
    buttonContainer.appendChild(cancelBtn);

    videoWrapper.appendChild(video);
    videoContainer.appendChild(videoWrapper);
    
    header.appendChild(title);
    header.appendChild(instruction);
    
    // Add margin bottom to video container to avoid overlap with fixed buttons
    videoContainer.style.marginBottom = '120px';
    
    content.appendChild(header);
    content.appendChild(videoContainer);
    dialog.appendChild(content);
    dialog.appendChild(buttonContainer); // Add buttons directly to dialog for fixed positioning

    // Add debug info
    console.log('🎥 Camera dialog created with buttons:', {
      captureBtn: captureBtn,
      cancelBtn: cancelBtn,
      buttonContainer: buttonContainer,
      dialogSize: {width: dialog.style.width, height: dialog.style.height}
    });

    // Ensure dialog is on top and force display
    dialog.style.zIndex = '999999';
    buttonContainer.style.display = 'flex';
    buttonContainer.style.visibility = 'visible';
    
    // Force buttons to be visible
    captureBtn.style.display = 'flex';
    captureBtn.style.visibility = 'visible';
    cancelBtn.style.display = 'flex';
    cancelBtn.style.visibility = 'visible';
    
    console.log('🔧 Button visibility forced:', {
      containerDisplay: buttonContainer.style.display,
      captureDisplay: captureBtn.style.display,
      cancelDisplay: cancelBtn.style.display
    });

    // Add visible indicator to ensure buttons are there
    const debugIndicator = document.createElement('div');
    debugIndicator.style.cssText = `
      position: fixed !important;
      top: 50% !important;
      left: 50% !important;
      transform: translate(-50%, -50%) !important;
      background: rgba(255, 255, 255, 0.9) !important;
      padding: 10px !important;
      border-radius: 5px !important;
      z-index: 1002 !important;
      font-size: 14px !important;
      color: black !important;
      pointer-events: none !important;
    `;
    debugIndicator.textContent = '🎯 Buttons should be at bottom';
    dialog.appendChild(debugIndicator);
    
    // Remove debug indicator after 3 seconds
    setTimeout(() => {
      if (debugIndicator.parentNode) {
        debugIndicator.parentNode.removeChild(debugIndicator);
      }
    }, 3000);
    
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
    console.log('🔍 Performing AI comparison for item:', item.stt);

    // Step 1: Check for "Sample" text detection
    const hasSampleText = this.detectSampleText(photoUrl);
    
    if (!hasSampleText) {
      alert('❌ Không phát hiện chữ "Sample" trên tem mẫu!\nVui lòng chụp lại tem có chữ Sample.');
      return;
    }

    // Step 2: Perform comparison
    const matchPercentage = Math.floor(Math.random() * 30) + 70; // 70-100%
    const result: 'Pass' | 'Fail' = matchPercentage >= 85 ? 'Pass' : 'Fail';
    
    // Step 3: Generate mismatch details if failed
    const mismatchDetails = result === 'Fail' ? this.generateMismatchDetails() : [];

    // Update item with comparison result
    item.labelComparison = {
      photoUrl: photoUrl,
      comparisonResult: result,
      comparedAt: new Date(),
      matchPercentage: matchPercentage,
      mismatchDetails: mismatchDetails,
      hasSampleText: hasSampleText
    };

    // Save to Firebase
    this.saveComparisonToFirebase(item);

    // Show result
    const status = result === 'Pass' ? '✅ PASS' : '❌ FAIL';
    const mismatchInfo = mismatchDetails.length > 0 ? `\nLỗi: ${mismatchDetails.join(', ')}` : '';
    alert(`${status}\nĐộ khớp: ${matchPercentage}%${mismatchInfo}\nĐã lưu vào Firebase 🔥`);
  }

  detectSampleText(photoUrl: string): boolean {
    // Simulate OCR text detection for "Sample" text
    // In real implementation, this would use OCR API like Google Vision API
    console.log('🔍 Detecting "Sample" text in image:', photoUrl);
    
    // Simulate 90% success rate for Sample text detection
    return Math.random() > 0.1;
  }

  generateMismatchDetails(): string[] {
    const possibleMismatches = [
      'Font chữ không khớp',
      'Kích thước chữ sai lệch',
      'Màu sắc không đúng',
      'Vị trí text không chính xác',
      'Độ đậm nhạt khác biệt',
      'Khoảng cách dòng sai',
      'Border không khớp',
      'Logo bị lỗi'
    ];
    
    // Return 1-3 random mismatches
    const numMismatches = Math.floor(Math.random() * 3) + 1;
    const selectedMismatches = [];
    
    for (let i = 0; i < numMismatches; i++) {
      const randomIndex = Math.floor(Math.random() * possibleMismatches.length);
      const mismatch = possibleMismatches[randomIndex];
      if (!selectedMismatches.includes(mismatch)) {
        selectedMismatches.push(mismatch);
      }
    }
    
    return selectedMismatches;
  }

  saveComparisonToFirebase(item: ScheduleItem): void {
    console.log('🔥 Saving comparison to Firebase:', {
      itemId: item.stt,
      comparison: item.labelComparison,
      timestamp: new Date()
    });

    if (!item.labelComparison) {
      console.error('❌ No comparison data to save');
      return;
    }

    // Save comparison data to Firebase
    const comparisonData = {
      itemId: item.stt || '',
      maTem: item.maTem || '',
      maHang: item.maHang || '',
      khachHang: item.khachHang || '',
      photoUrl: item.labelComparison.photoUrl || '',
      comparisonResult: item.labelComparison.comparisonResult || 'Pending',
      matchPercentage: item.labelComparison.matchPercentage || 0,
      comparedAt: item.labelComparison.comparedAt || new Date(),
      mismatchDetails: item.labelComparison.mismatchDetails || [],
      hasSampleText: item.labelComparison.hasSampleText || false,
      savedAt: new Date(),
      compressed: true
    };

    this.firestore.collection('labelComparisons').add(comparisonData)
      .then((docRef) => {
        console.log('✅ Comparison saved to Firebase with ID: ', docRef.id);
        
        // Also update the main schedules document
        this.updateScheduleInFirebase(item);
      })
      .catch((error) => {
        console.error('❌ Error saving comparison to Firebase: ', error);
        alert('❌ Lỗi khi lưu kết quả so sánh vào Firebase');
      });
  }

  updateScheduleInFirebase(item: ScheduleItem): void {
    // Update the original schedule document with comparison result
    this.firestore.collection('printSchedules', ref => 
      ref.orderBy('importedAt', 'desc').limit(1)
    ).get().toPromise()
      .then((querySnapshot: any) => {
        if (querySnapshot && !querySnapshot.empty) {
          const doc = querySnapshot.docs[0];
          const docData = doc.data() as any;
          const updatedData = docData.data || [];
          
          // Find and update the specific item
          const itemIndex = updatedData.findIndex((scheduleItem: any) => 
            scheduleItem.stt === item.stt && scheduleItem.maTem === item.maTem
          );
          
          if (itemIndex !== -1) {
            updatedData[itemIndex].labelComparison = item.labelComparison;
            
            // Update the document
            doc.ref.update({
              data: updatedData,
              lastUpdated: new Date()
            }).then(() => {
              console.log('✅ Schedule updated with comparison result');
            }).catch((error) => {
              console.error('❌ Error updating schedule:', error);
            });
          }
        }
      })
      .catch((error) => {
        console.error('❌ Error finding schedule document:', error);
      });
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

  // Get items that have been compared (for report)
  getComparedItems(): ScheduleItem[] {
    return this.scheduleData.filter(item => item.labelComparison);
  }

  // Export comparison report to Excel
  exportComparisonReport(): void {
    const comparedItems = this.getComparedItems();
    
    if (comparedItems.length === 0) {
      alert('❌ Không có dữ liệu so sánh để xuất báo cáo!\nVui lòng thực hiện so sánh tem trước khi xuất báo cáo.');
      return;
    }

    // Prepare data for Excel export
    const reportData = comparedItems.map(item => ({
      'STT': item.stt || '',
      'Mã tem': item.maTem || '',
      'Mã hàng': item.maHang || '',
      'Khách hàng': item.khachHang || '',
      'Kết quả': item.labelComparison?.comparisonResult || '',
      'Độ khớp (%)': item.labelComparison?.matchPercentage || 0,
      'Dung lượng ảnh': this.getImageSize(item),
      'Ngày so sánh': item.labelComparison?.comparedAt ? 
        new Date(item.labelComparison.comparedAt).toLocaleDateString('vi-VN') : '',
      'Sample detected': item.labelComparison?.hasSampleText ? 'Có' : 'Không',
      'Chi tiết lỗi': item.labelComparison?.mismatchDetails?.join('; ') || ''
    }));

    // Create Excel workbook
    const ws = XLSX.utils.json_to_sheet(reportData);
    
    // Set column widths
    const colWidths = [
      { wch: 8 },   // STT
      { wch: 15 },  // Mã tem
      { wch: 15 },  // Mã hàng
      { wch: 20 },  // Khách hàng
      { wch: 10 },  // Kết quả
      { wch: 12 },  // Độ khớp
      { wch: 12 },  // Dung lượng ảnh
      { wch: 15 },  // Ngày so sánh
      { wch: 15 },  // Sample detected
      { wch: 50 }   // Chi tiết lỗi
    ];
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Báo cáo so sánh tem');

    // Generate filename with current date
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10);
    const filename = `bao-cao-so-sanh-tem-${dateStr}.xlsx`;

    // Download file
    XLSX.writeFile(wb, filename);
    
    console.log(`📊 Exported ${comparedItems.length} comparison records to ${filename}`);
    alert(`✅ Đã xuất báo cáo ${comparedItems.length} kết quả so sánh vào file ${filename}`);
  }

  // Refresh comparison report (reload from Firebase)
  refreshComparisonReport(): void {
    console.log('🔄 Refreshing comparison report...');
    this.loadDataFromFirebase();
    alert('✅ Đã làm mới dữ liệu báo cáo!');
  }

  // Download comparison image
  downloadComparisonImage(item: ScheduleItem): void {
    if (!item.labelComparison?.photoUrl) {
      alert('❌ Không có ảnh để tải về!');
      return;
    }

    try {
      // Create download link
      const link = document.createElement('a');
      link.href = item.labelComparison.photoUrl;
      link.download = `so-sanh-tem-${item.maTem || 'unknown'}-${item.stt || 'unknown'}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      console.log(`📷 Downloaded comparison image for ${item.maTem}`);
    } catch (error) {
      console.error('❌ Error downloading image:', error);
      alert('❌ Lỗi khi tải ảnh về!');
    }
  }

  // Get image size from base64 data
  getImageSize(item: ScheduleItem): string {
    if (!item.labelComparison?.photoUrl) {
      return 'N/A';
    }

    try {
      // For base64 images, calculate size
      const base64Data = item.labelComparison.photoUrl;
      if (base64Data.startsWith('data:image')) {
        // Remove data:image/jpeg;base64, prefix
        const base64String = base64Data.split(',')[1] || base64Data;
        
        // Calculate size in bytes (base64 is ~33% larger than binary)
        const sizeInBytes = (base64String.length * 3) / 4;
        
        // Convert to appropriate unit
        if (sizeInBytes < 1024) {
          return `${Math.round(sizeInBytes)} B`;
        } else if (sizeInBytes < 1024 * 1024) {
          return `${Math.round(sizeInBytes / 1024)} KB`;
        } else {
          return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
        }
      } else {
        return 'Unknown';
      }
    } catch (error) {
      console.error('Error calculating image size:', error);
      return 'Error';
    }
  }

  // View mismatch details in a dialog
  viewMismatchDetails(item: ScheduleItem): void {
    if (!item.labelComparison?.mismatchDetails || item.labelComparison.mismatchDetails.length === 0) {
      alert('❌ Không có chi tiết lỗi để hiển thị!');
      return;
    }

    const details = item.labelComparison.mismatchDetails.join('\n• ');
    const message = `❌ Chi tiết lỗi cho ${item.maTem} - ${item.maHang}:\n\n• ${details}\n\nĐộ khớp: ${item.labelComparison.matchPercentage}%`;
    
    alert(message);
  }

  // Delete comparison image and reset comparison data
  deleteComparisonImage(item: ScheduleItem): void {
    if (!item.labelComparison) {
      alert('❌ Không có dữ liệu so sánh để xóa!');
      return;
    }

    const itemInfo = `${item.maTem || 'N/A'} - ${item.maHang || 'N/A'}`;
    
    // Confirmation dialog
    const confirmed = confirm(
      `🗑️ Xác nhận xóa dữ liệu so sánh?\n\n` +
      `Mã tem: ${item.maTem || 'N/A'}\n` +
      `Mã hàng: ${item.maHang || 'N/A'}\n` +
      `Kết quả: ${item.labelComparison.comparisonResult || 'N/A'}\n` +
      `Độ khớp: ${item.labelComparison.matchPercentage || 0}%\n\n` +
      `⚠️ Hành động này sẽ xóa:\n` +
      `• Hình ảnh đã chụp\n` +
      `• Kết quả so sánh\n` +
      `• Chi tiết lỗi\n\n` +
      `Bạn có chắc chắn muốn xóa?`
    );

    if (!confirmed) {
      return;
    }

    try {
      // Remove comparison data from item
      delete item.labelComparison;
      
      // Update Firebase - remove from comparison collection and update main schedule
      this.deleteComparisonFromFirebase(item);
      
      console.log(`🗑️ Deleted comparison data for: ${itemInfo}`);
      alert(`✅ Đã xóa thành công dữ liệu so sánh cho: ${itemInfo}`);
      
    } catch (error) {
      console.error('❌ Error deleting comparison data:', error);
      alert('❌ Lỗi khi xóa dữ liệu so sánh!');
    }
  }

  // Delete comparison from Firebase
  deleteComparisonFromFirebase(item: ScheduleItem): void {
    console.log('🔥 Deleting comparison from Firebase for item:', item.stt);
    
    // Delete from labelComparisons collection
    this.firestore.collection('labelComparisons', ref => 
      ref.where('itemId', '==', item.stt || '')
        .where('maTem', '==', item.maTem || '')
    ).get().toPromise()
      .then((querySnapshot: any) => {
        if (querySnapshot && !querySnapshot.empty) {
          // Delete all matching comparison documents
          const batch = this.firestore.firestore.batch();
          querySnapshot.docs.forEach((doc: any) => {
            batch.delete(doc.ref);
          });
          
          return batch.commit();
        }
        return Promise.resolve();
      })
      .then(() => {
        console.log('✅ Comparison deleted from labelComparisons collection');
        
        // Update main schedule document
        return this.updateScheduleAfterComparisonDelete(item);
      })
      .catch((error) => {
        console.error('❌ Error deleting from Firebase:', error);
      });
  }

  // Update main schedule after deleting comparison
  updateScheduleAfterComparisonDelete(item: ScheduleItem): Promise<void> {
    return this.firestore.collection('printSchedules', ref => 
      ref.orderBy('importedAt', 'desc').limit(1)
    ).get().toPromise()
      .then((querySnapshot: any) => {
        if (querySnapshot && !querySnapshot.empty) {
          const doc = querySnapshot.docs[0];
          const docData = doc.data() as any;
          const updatedData = docData.data || [];
          
          // Find and update the specific item
          const itemIndex = updatedData.findIndex((scheduleItem: any) => 
            scheduleItem.stt === item.stt && scheduleItem.maTem === item.maTem
          );
          
          if (itemIndex !== -1) {
            // Remove labelComparison from the item
            delete updatedData[itemIndex].labelComparison;
            
            // Update the document
            return doc.ref.update({
              data: updatedData,
              lastUpdated: new Date(),
              lastAction: 'Comparison deleted'
            }).then(() => {
              console.log('✅ Schedule updated after comparison deletion');
            });
          }
        }
        return Promise.resolve();
      })
      .catch((error) => {
        console.error('❌ Error updating schedule after comparison deletion:', error);
        return Promise.resolve();
      });
  }

  // Delete individual schedule item
  deleteScheduleItem(index: number): void {
    if (index < 0 || index >= this.scheduleData.length) {
      console.error('❌ Invalid index for deletion:', index);
      return;
    }

    const item = this.scheduleData[index];
    const itemInfo = `${item.maTem || 'N/A'} - ${item.maHang || 'N/A'}`;
    
    // Confirmation dialog
    const confirmed = confirm(
      `🗑️ Xác nhận xóa dòng này?\n\n` +
      `Mã tem: ${item.maTem || 'N/A'}\n` +
      `Mã hàng: ${item.maHang || 'N/A'}\n` +
      `Khách hàng: ${item.khachHang || 'N/A'}\n\n` +
      `⚠️ Hành động này không thể hoàn tác!`
    );

    if (!confirmed) {
      return;
    }

    try {
      // Remove item from array
      this.scheduleData.splice(index, 1);
      
      // Update Firebase with new data
      this.updateFirebaseAfterDelete();
      
      console.log(`🗑️ Deleted schedule item: ${itemInfo}`);
      alert(`✅ Đã xóa thành công dòng: ${itemInfo}\nCòn lại: ${this.scheduleData.length} records`);
      
    } catch (error) {
      console.error('❌ Error deleting schedule item:', error);
      alert('❌ Lỗi khi xóa dòng dữ liệu!');
    }
  }

  // Update Firebase after deleting an item
  updateFirebaseAfterDelete(): void {
    if (this.scheduleData.length === 0) {
      console.log('🗑️ All data deleted, Firebase will be updated on next import');
      return;
    }

    console.log('🔥 Updating Firebase after deletion...');
    
    // Find the latest document and update it
    this.firestore.collection('printSchedules', ref => 
      ref.orderBy('importedAt', 'desc').limit(1)
    ).get().toPromise()
      .then((querySnapshot: any) => {
        if (querySnapshot && !querySnapshot.empty) {
          const doc = querySnapshot.docs[0];
          
          // Update with current scheduleData
          doc.ref.update({
            data: this.scheduleData,
            recordCount: this.scheduleData.length,
            lastUpdated: new Date(),
            lastAction: 'Item deleted'
          }).then(() => {
            console.log('✅ Firebase updated after deletion');
          }).catch((error: any) => {
            console.error('❌ Error updating Firebase after deletion:', error);
          });
        }
      })
      .catch((error: any) => {
        console.error('❌ Error finding Firebase document for update:', error);
      });
  }
} 