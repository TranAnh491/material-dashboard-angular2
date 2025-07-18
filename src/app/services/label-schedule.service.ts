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

    // Map Excel columns to our model (based on the Excel structure in the image)
    const columnMapping = {
      0: 'nam',           // Năm
      1: 'thang',         // Tháng  
      2: 'stt',           // STT
      3: 'kichThuocKhoi', // Kích thước khôi
      4: 'maTem',         // Mã tem
      5: 'soLuongYeuCau', // Số lượng yêu cầu
      6: 'soLuongAuto1',  // Số lượng (auto) *3
      7: 'maSanPham',     // Mã sản phẩm
      8: 'soLenhSanXuat', // Số lệnh sản xuất
      9: 'khachHang',     // Khách hàng (auto)
      10: 'ngayKhoiTao',  // Ngày khởi tạo lệnh gửi
      11: 'vt',           // VT
      12: 'hw',           // HW
      13: 'lua',          // Lửa
      14: 'nguoiDi',      // Người đi
      15: 'tinhTrang',    // Tình trạng
      16: 'donVi',        // Đơn vị
      17: 'note',         // Note
      18: 'thoiGianInPhai' // Thời gian in (phải)
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
            case 'soLuongAuto1':
              schedule[fieldName] = this.parseNumber(value);
              break;
              
            case 'ngayKhoiTao':
            case 'thoiGianInPhai':
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
    return !!(schedule.maTem && schedule.nam && schedule.thang);
  }

  // Export to Excel
  exportToExcel(schedules: LabelScheduleData[], filename: string = 'label-schedules'): void {
    const ws = XLSX.utils.json_to_sheet(schedules);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Label Schedules');
    XLSX.writeFile(wb, `${filename}.xlsx`);
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