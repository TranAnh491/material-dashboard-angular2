import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import { LabelScheduleData, ExcelImportResult, LabelScheduleFilter } from '../models/label-schedule.model';

@Injectable({
  providedIn: 'root'
})
export class LabelScheduleService {
  private collectionName = 'labelSchedules';

  constructor(private firestore: AngularFirestore) {}

  // Firebase CRUD Operations
  getAllSchedules(): Observable<LabelScheduleData[]> {
    return this.firestore.collection<LabelScheduleData>(this.collectionName, ref => 
      ref.orderBy('createdAt', 'desc')
    ).snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as LabelScheduleData;
        const id = a.payload.doc.id;
        return { id, ...data };
      }))
    );
  }

  getSchedulesByFilter(filter: LabelScheduleFilter): Observable<LabelScheduleData[]> {
    return this.firestore.collection<LabelScheduleData>(this.collectionName, ref => {
      let query: any = ref;
      
      if (filter.nam) {
        query = query.where('nam', '==', filter.nam);
      }
      if (filter.thang) {
        query = query.where('thang', '==', filter.thang);
      }
      if (filter.status) {
        query = query.where('status', '==', filter.status);
      }
      if (filter.khachHang) {
        query = query.where('khachHang', '==', filter.khachHang);
      }
      
      return query.orderBy('createdAt', 'desc');
    }).snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as LabelScheduleData;
        const id = a.payload.doc.id;
        return { id, ...data };
      }))
    );
  }

  addSchedule(schedule: LabelScheduleData): Promise<any> {
    const data = {
      ...schedule,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: schedule.status || 'pending',
      progress: schedule.progress || 0
    };
    return this.firestore.collection(this.collectionName).add(data);
  }

  updateSchedule(id: string, schedule: Partial<LabelScheduleData>): Promise<any> {
    const data = {
      ...schedule,
      updatedAt: new Date()
    };
    return this.firestore.collection(this.collectionName).doc(id).update(data);
  }

  deleteSchedule(id: string): Promise<any> {
    return this.firestore.collection(this.collectionName).doc(id).delete();
  }

  bulkAddSchedules(schedules: LabelScheduleData[]): Promise<any[]> {
    const batch = this.firestore.firestore.batch();
    const promises: Promise<any>[] = [];

    schedules.forEach(schedule => {
      const data = {
        ...schedule,
        createdAt: new Date(),
        updatedAt: new Date(),
        status: schedule.status || 'pending',
        progress: schedule.progress || 0
      };
      
      const docRef = this.firestore.collection(this.collectionName).doc().ref;
      batch.set(docRef, data);
    });

    promises.push(batch.commit());
    return Promise.all(promises);
  }

  // Excel Import Functions
  importFromExcel(file: File): Promise<ExcelImportResult> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e: any) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          
          const result = this.processExcelData(jsonData);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  private processExcelData(rawData: any[]): ExcelImportResult {
    const result: ExcelImportResult = {
      success: false,
      totalRows: 0,
      validRows: 0,
      errors: [],
      data: []
    };

    if (rawData.length < 2) {
      result.errors.push('File Excel không có dữ liệu hoặc thiếu header');
      return result;
    }

    const headers = rawData[0];
    const dataRows = rawData.slice(1);
    result.totalRows = dataRows.length;

    // Map Excel columns to our model (based on the new structure)
    const columnMapping = {
      0: 'nam',               // Năm
      1: 'thang',             // Tháng  
      2: 'stt',               // STT
      3: 'kichThuocKhoi',     // Kích thước khối
      4: 'maTem',             // Mã tem
      5: 'soLuongYeuCau',     // Số lượng yêu cầu
      6: 'soLuongPhoi',       // Số lượng phôi
      7: 'maHang',            // Mã Hàng
      8: 'lenhSanXuat',       // Lệnh sản xuất
      9: 'khachHang',         // Khách hàng
      10: 'ngayNhanKeHoach',  // Ngày nhận kế hoạch
      11: 'yy',               // YY
      12: 'ww',               // WW
      13: 'lineNhan',         // Line nhận
      14: 'nguoiIn',          // Người in
      15: 'tinhTrang',        // Tình trạng
      16: 'banVe',            // Bản vẽ
      17: 'ghiChu'            // Ghi chú
    };

    dataRows.forEach((row, index) => {
      try {
        if (this.isRowEmpty(row)) {
          return; // Skip empty rows
        }

        const schedule: LabelScheduleData = {} as LabelScheduleData;
        
        // Map each column to the corresponding field
        Object.entries(columnMapping).forEach(([colIndex, fieldName]) => {
          const value = row[parseInt(colIndex)];
          
          switch (fieldName) {
            case 'nam':
            case 'thang':
            case 'stt':
            case 'soLuongYeuCau':
            case 'soLuongPhoi':
              schedule[fieldName] = this.parseNumber(value);
              break;
              
            case 'ngayNhanKeHoach':
              schedule[fieldName] = this.parseDate(value);
              break;
              
            default:
              schedule[fieldName] = this.parseString(value);
          }
        });

        // Validate required fields
        if (this.validateSchedule(schedule)) {
          result.data.push(schedule);
          result.validRows++;
        } else {
          result.errors.push(`Dòng ${index + 2}: Thiếu thông tin bắt buộc (Mã tem, Năm, Tháng)`);
        }
        
      } catch (error) {
        result.errors.push(`Dòng ${index + 2}: ${error.message}`);
      }
    });

    result.success = result.validRows > 0;
    return result;
  }

  private isRowEmpty(row: any[]): boolean {
    return !row || row.every(cell => cell === null || cell === undefined || cell === '');
  }

  private parseNumber(value: any): number {
    if (value === null || value === undefined || value === '') return 0;
    const num = parseFloat(value);
    return isNaN(num) ? 0 : num;
  }

  private parseString(value: any): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  private parseDate(value: any): Date {
    if (!value) return new Date();
    
    // Handle Excel date serial numbers
    if (typeof value === 'number') {
      const excelEpoch = new Date(1900, 0, 1);
      const date = new Date(excelEpoch.getTime() + (value - 1) * 24 * 60 * 60 * 1000);
      return date;
    }
    
    // Handle string dates
    const date = new Date(value);
    return isNaN(date.getTime()) ? new Date() : date;
  }

  private validateSchedule(schedule: LabelScheduleData): boolean {
    const isValid = !!(schedule.maTem && schedule.nam && schedule.thang);
    if (!isValid) {
      console.warn('⚠️ Invalid schedule:', schedule);
    }
    return isValid;
  }

  // Export to Excel
  exportToExcel(schedules: LabelScheduleData[], filename: string = 'label-schedules'): void {
    try {
      // Transform data for export with proper column headers
      const exportData = schedules.map(schedule => ({
        'Năm': schedule.nam,
        'Tháng': schedule.thang,
        'STT': schedule.stt,
        'Kích thước khối': schedule.kichThuocKhoi,
        'Mã tem': schedule.maTem,
        'Số lượng yêu cầu': schedule.soLuongYeuCau,
        'Số lượng phôi': schedule.soLuongPhoi,
        'Mã Hàng': schedule.maHang,
        'Lệnh sản xuất': schedule.lenhSanXuat,
        'Khách hàng': schedule.khachHang,
        'Ngày nhận kế hoạch': schedule.ngayNhanKeHoach,
        'YY': schedule.yy,
        'WW': schedule.ww,
        'Line nhận': schedule.lineNhan,
        'Người in': schedule.nguoiIn,
        'Tình trạng': schedule.tinhTrang,
        'Bản vẽ': schedule.banVe,
        'Ghi chú': schedule.ghiChu
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Lịch in tem');
    XLSX.writeFile(wb, `${filename}.xlsx`);
    } catch (error) {
      console.error('Export error:', error);
      throw error;
    }
  }

  // Create and download Excel template
  createTemplate(templateData: any[]): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Create worksheet
        const worksheet = XLSX.utils.json_to_sheet(templateData);
        
        // Set column widths
        const colWidths = [
          { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 15 }, { wch: 12 }, 
          { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 20 }, { wch: 15 },
          { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 12 },
          { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }
        ];
        worksheet['!cols'] = colWidths;

        // Create workbook
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Lịch in tem');

        // Add instructions sheet
        const instructionsData = [
          { 'Cột': 'Năm', 'Mô tả': 'Năm lập lịch (ví dụ: 2024)', 'Bắt buộc': 'Có' },
          { 'Cột': 'Tháng', 'Mô tả': 'Tháng lập lịch (1-12)', 'Bắt buộc': 'Có' },
          { 'Cột': 'STT', 'Mô tả': 'Số thứ tự', 'Bắt buộc': 'Có' },
          { 'Cột': 'Kích thước khối', 'Mô tả': 'Kích thước khối in (ví dụ: 40*25)', 'Bắt buộc': 'Có' },
          { 'Cột': 'Mã tem', 'Mô tả': 'Mã định danh tem', 'Bắt buộc': 'Có' },
          { 'Cột': 'Số lượng yêu cầu', 'Mô tả': 'Số lượng tem cần in', 'Bắt buộc': 'Có' },
          { 'Cột': 'Số lượng phôi', 'Mô tả': 'Số lượng phôi cần thiết', 'Bắt buộc': 'Không' },
          { 'Cột': 'Mã Hàng', 'Mô tả': 'Mã sản phẩm cần dán tem', 'Bắt buộc': 'Không' },
          { 'Cột': 'Lệnh sản xuất', 'Mô tả': 'Số lệnh sản xuất', 'Bắt buộc': 'Không' },
          { 'Cột': 'Khách hàng', 'Mô tả': 'Tên khách hàng', 'Bắt buộc': 'Có' },
          { 'Cột': 'Ngày nhận kế hoạch', 'Mô tả': 'Ngày nhận kế hoạch (YYYY-MM-DD)', 'Bắt buộc': 'Không' },
          { 'Cột': 'YY', 'Mô tả': 'Mã năm (ví dụ: 25 cho 2025)', 'Bắt buộc': 'Không' },
          { 'Cột': 'WW', 'Mô tả': 'Mã tuần (ví dụ: 07 cho tuần 7)', 'Bắt buộc': 'Không' },
          { 'Cột': 'Line nhận', 'Mô tả': 'Line nhận hàng', 'Bắt buộc': 'Không' },
          { 'Cột': 'Người in', 'Mô tả': 'Người thực hiện in', 'Bắt buộc': 'Không' },
          { 'Cột': 'Tình trạng', 'Mô tả': 'Trạng thái: Chờ xử lý/Đang in/Hoàn thành', 'Bắt buộc': 'Không' },
          { 'Cột': 'Bản vẽ', 'Mô tả': 'Mã bản vẽ', 'Bắt buộc': 'Không' },
          { 'Cột': 'Ghi chú', 'Mô tả': 'Ghi chú thêm', 'Bắt buộc': 'Không' }
        ];
        
        const instructionsSheet = XLSX.utils.json_to_sheet(instructionsData);
        instructionsSheet['!cols'] = [{ wch: 20 }, { wch: 40 }, { wch: 10 }];
        XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Hướng dẫn');

        // Download file
        const filename = `template-lich-in-tem-${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(workbook, filename);
        
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Get unique values for filters
  getUniqueYears(): Observable<number[]> {
    return this.getAllSchedules().pipe(
      map(schedules => {
        const years = schedules.map(s => s.nam).filter(year => year);
        return [...new Set(years)].sort((a, b) => b - a);
      })
    );
  }

  getUniqueCustomers(): Observable<string[]> {
    return this.getAllSchedules().pipe(
      map(schedules => {
        const customers = schedules.map(s => s.khachHang).filter(customer => customer);
        return [...new Set(customers)].sort();
      })
    );
  }

  getUniqueStatuses(): Observable<string[]> {
    return this.getAllSchedules().pipe(
      map(schedules => {
        const statuses = schedules.map(s => s.status).filter(status => status);
        return [...new Set(statuses)].sort();
      })
    );
  }
} 