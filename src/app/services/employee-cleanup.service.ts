import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

export interface EmployeeComparison {
  employeeId: string;
  inSettings: boolean;
  inFirebase: boolean;
  usageCount: number;
  collections: string[];
  lastUsed?: Date;
}

export interface CleanupResult {
  totalSettings: number;
  totalFirebase: number;
  validEmployees: number;
  redundantEmployees: EmployeeComparison[];
  missingEmployees: string[];
  summary: string;
}

@Injectable({
  providedIn: 'root'
})
export class EmployeeCleanupService {

  constructor(private firestore: AngularFirestore) { }

  /**
   * So sánh mã nhân viên giữa Settings và Firebase
   */
  async compareEmployees(): Promise<CleanupResult> {
    console.log('🔍 Bắt đầu so sánh mã nhân viên...');

    try {
      // 1. Lấy mã nhân viên từ Settings (tất cả nguồn)
      const settingsEmployeeIds = await this.getSettingsEmployeeIds();
      console.log(`📋 Settings: ${settingsEmployeeIds.size} mã nhân viên`);

      // 2. Lấy mã nhân viên từ các collection khác
      const firebaseEmployeeIds = await this.getFirebaseEmployeeIds();
      console.log(`🔥 Firebase: ${firebaseEmployeeIds.size} mã nhân viên`);

      // 3. So sánh và phân loại
      const result = this.compareEmployeeLists(settingsEmployeeIds, firebaseEmployeeIds);
      
      console.log('✅ Hoàn thành so sánh mã nhân viên');
      return result;

    } catch (error) {
      console.error('❌ Lỗi khi so sánh mã nhân viên:', error);
      throw error;
    }
  }

  /**
   * So sánh mã nhân viên với danh sách users từ Settings component
   */
  async compareEmployeesWithSettingsUsers(settingsUsers: any[]): Promise<CleanupResult> {
    console.log('🔍 Bắt đầu so sánh mã nhân viên với Settings users...');

    try {
      // 1. Lấy mã nhân viên từ danh sách users trong Settings
      const settingsEmployeeIds = this.extractEmployeeIdsFromSettingsUsers(settingsUsers);
      console.log(`📋 Settings Users: ${settingsEmployeeIds.size} mã nhân viên`);

      // 2. Lấy mã nhân viên từ các collection khác
      const firebaseEmployeeIds = await this.getFirebaseEmployeeIds();
      console.log(`🔥 Firebase: ${firebaseEmployeeIds.size} mã nhân viên`);

      // 3. So sánh và phân loại
      const result = this.compareEmployeeLists(settingsEmployeeIds, firebaseEmployeeIds);
      
      console.log('✅ Hoàn thành so sánh mã nhân viên với Settings users');
      return result;

    } catch (error) {
      console.error('❌ Lỗi khi so sánh mã nhân viên với Settings users:', error);
      throw error;
    }
  }

  /**
   * Trích xuất mã nhân viên từ danh sách users trong Settings
   * CHỈ lấy mã nhân viên format ASP + 4 số
   */
  private extractEmployeeIdsFromSettingsUsers(settingsUsers: any[]): Set<string> {
    const employeeIds = new Set<string>();
    
    console.log('🔍 Trích xuất mã nhân viên từ Settings users (chỉ ASP + 4 số)...');
    
    settingsUsers.forEach(user => {
      let empId = '';
      
      // 1. Special users - bỏ qua
      if (user.uid === 'special-steve-uid') {
        console.log(`  ⏭️ Bỏ qua special user: Steve`);
        return;
      }
      
      // 2. Admin - bỏ qua
      if (user.email === 'admin@asp.com') {
        console.log(`  ⏭️ Bỏ qua admin user`);
        return;
      }
      
      // 3. Từ employeeId field - CHỈ lấy nếu đúng format ASP + 4 số
      if (user.employeeId && user.employeeId.trim()) {
        const trimmedId = user.employeeId.trim();
        if (trimmedId.match(/^ASP\d{4}$/i)) {
          empId = trimmedId.toUpperCase();
          employeeIds.add(empId);
          console.log(`  ✅ employeeId: ${empId}`);
          return;
        } else {
          console.log(`  ⏭️ Bỏ qua employeeId không đúng format: ${trimmedId}`);
        }
      }
      
      // 4. Từ displayName - CHỈ lấy nếu đúng format ASP + 4 số
      if (user.displayName && user.displayName.match(/^ASP\d{4}$/i)) {
        empId = user.displayName.toUpperCase();
        employeeIds.add(empId);
        console.log(`  ✅ displayName: ${empId}`);
        return;
      }
      
      // 5. Từ email pattern (aspXXXX@...) - CHỈ lấy 4 số và tạo ASP + 4 số
      if (user.email && user.email.toLowerCase().startsWith('asp')) {
        const match = user.email.match(/^asp(\d{4})@/i);
        if (match) {
          empId = `ASP${match[1]}`;
          employeeIds.add(empId);
          console.log(`  ✅ email pattern: ${empId} (from ${user.email})`);
          return;
        }
      }
      
      // 6. Bỏ qua tất cả email khác (@gmail, @yahoo, etc.)
      if (user.email && (user.email.includes('@gmail') || user.email.includes('@yahoo') || user.email.includes('@hotmail'))) {
        console.log(`  ⏭️ Bỏ qua email không phải ASP: ${user.email}`);
        return;
      }
      
      // 7. Nếu không tìm thấy mã nhân viên hợp lệ
      if (!empId) {
        console.log(`  ⏭️ Bỏ qua user không có mã nhân viên hợp lệ: ${user.email || user.displayName || 'Unknown'}`);
      }
    });
    
    console.log(`📊 Tổng cộng ${employeeIds.size} mã nhân viên hợp lệ (ASP + 4 số) từ Settings users`);
    return employeeIds;
  }

  /**
   * Lấy danh sách mã nhân viên từ Settings (từ tất cả nguồn)
   */
  private async getSettingsEmployeeIds(): Promise<Set<string>> {
    const employeeIds = new Set<string>();
    
    try {
      console.log('🔍 Lấy mã nhân viên từ tất cả nguồn trong Settings...');
      
      // 1. Lấy từ user-permissions collection
      const permissionsSnapshot = await this.firestore.collection('user-permissions').get().toPromise();
      permissionsSnapshot?.forEach(doc => {
        const data = doc.data() as any;
        if (data.employeeId && data.employeeId.trim()) {
          employeeIds.add(data.employeeId.trim());
          console.log(`  ✅ user-permissions: ${data.employeeId}`);
        }
      });
      
      // 2. Lấy từ users collection
      const usersSnapshot = await this.firestore.collection('users').get().toPromise();
      usersSnapshot?.forEach(doc => {
        const data = doc.data() as any;
        if (data.employeeId && data.employeeId.trim()) {
          employeeIds.add(data.employeeId.trim());
          console.log(`  ✅ users: ${data.employeeId}`);
        }
      });
      
      // 3. Lấy từ email pattern (aspXXXX@...)
      usersSnapshot?.forEach(doc => {
        const data = doc.data() as any;
        if (data.email && data.email.toLowerCase().startsWith('asp')) {
          const match = data.email.match(/^asp(\d{4})@/i);
          if (match) {
            const empId = `ASP${match[1]}`;
            employeeIds.add(empId);
            console.log(`  ✅ email pattern: ${empId} (from ${data.email})`);
          }
        }
      });
      
      // 4. Lấy từ displayName nếu có pattern ASP
      usersSnapshot?.forEach(doc => {
        const data = doc.data() as any;
        if (data.displayName && data.displayName.match(/^ASP\d{4}$/i)) {
          const empId = data.displayName.toUpperCase();
          employeeIds.add(empId);
          console.log(`  ✅ displayName: ${empId}`);
        }
      });
      
      console.log(`📊 Tổng cộng ${employeeIds.size} mã nhân viên từ Settings`);
      
    } catch (error) {
      console.error('❌ Lỗi khi lấy mã nhân viên từ Settings:', error);
    }
    
    return employeeIds;
  }

  /**
   * Lấy danh sách mã nhân viên từ các collection Firebase
   */
  private async getFirebaseEmployeeIds(): Promise<Map<string, { count: number, collections: string[], lastUsed?: Date }>> {
    const employeeMap = new Map<string, { count: number, collections: string[], lastUsed?: Date }>();
    
    const collectionsToCheck = [
      'inbound-materials',
      'outbound-materials', 
      'materials-asm1',
      'materials-asm2',
      'work-orders',
      'shipment-items',
      'label-schedules',
      'safety-materials',
      'training-reports',
      'audit-logs'
    ];

    for (const collectionName of collectionsToCheck) {
      try {
        const snapshot = await this.firestore.collection(collectionName).get().toPromise();
        
        snapshot?.forEach(doc => {
          const data = doc.data() as any;
          const employeeFields = ['employeeId', 'exportedBy', 'createdBy', 'checkedBy', 'performedBy', 'scannedBy'];
          
          employeeFields.forEach(field => {
            if (data[field] && data[field].toString().trim()) {
              const empId = data[field].toString().trim();
              
              // CHỈ lấy mã nhân viên đúng format ASP + 4 số
              if (empId && empId !== 'N/A' && empId !== '' && empId.match(/^ASP\d{4}$/i)) {
                const normalizedEmpId = empId.toUpperCase();
                
                if (!employeeMap.has(normalizedEmpId)) {
                  employeeMap.set(normalizedEmpId, { count: 0, collections: [], lastUsed: undefined });
                }
                
                const empData = employeeMap.get(normalizedEmpId)!;
                empData.count++;
                
                if (!empData.collections.includes(collectionName)) {
                  empData.collections.push(collectionName);
                }
                
                // Cập nhật thời gian sử dụng cuối cùng
                const timestamp = data.createdAt || data.updatedAt || data.scanTime || data.exportDate;
                if (timestamp) {
                  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
                  if (!empData.lastUsed || date > empData.lastUsed) {
                    empData.lastUsed = date;
                  }
                }
                
                console.log(`    ✅ ${collectionName}: ${normalizedEmpId} (${field})`);
              } else if (empId && empId !== 'N/A' && empId !== '') {
                console.log(`    ⏭️ Bỏ qua ${field} không đúng format: ${empId}`);
              }
            }
          });
        });
        
        console.log(`  ✅ ${collectionName}: ${snapshot?.size || 0} documents`);
      } catch (error) {
        console.log(`  ⚠️ Lỗi khi kiểm tra ${collectionName}:`, error);
      }
    }
    
    return employeeMap;
  }

  /**
   * So sánh danh sách mã nhân viên
   */
  private compareEmployeeLists(
    settingsIds: Set<string>, 
    firebaseMap: Map<string, { count: number, collections: string[], lastUsed?: Date }>
  ): CleanupResult {
    const redundantEmployees: EmployeeComparison[] = [];
    const missingEmployees: string[] = [];
    
    // Tìm mã nhân viên dư thừa (có trong Firebase nhưng không có trong Settings)
    for (const [empId, data] of firebaseMap) {
      if (!settingsIds.has(empId)) {
        redundantEmployees.push({
          employeeId: empId,
          inSettings: false,
          inFirebase: true,
          usageCount: data.count,
          collections: data.collections,
          lastUsed: data.lastUsed
        });
      }
    }
    
    // Tìm mã nhân viên thiếu (có trong Settings nhưng không có trong Firebase)
    for (const empId of settingsIds) {
      if (!firebaseMap.has(empId)) {
        missingEmployees.push(empId);
      }
    }
    
    const validEmployees = settingsIds.size - missingEmployees.length;
    
    return {
      totalSettings: settingsIds.size,
      totalFirebase: firebaseMap.size,
      validEmployees: validEmployees,
      redundantEmployees: redundantEmployees.sort((a, b) => b.usageCount - a.usageCount),
      missingEmployees: missingEmployees.sort(),
      summary: `Tổng cộng: ${settingsIds.size} trong Settings, ${firebaseMap.size} trong Firebase. Hợp lệ: ${validEmployees}, Dư thừa: ${redundantEmployees.length}, Thiếu: ${missingEmployees.length}`
    };
  }

  /**
   * Xóa mã nhân viên dư thừa khỏi Firebase
   */
  async cleanupRedundantEmployees(employeeIds: string[]): Promise<{ success: number, errors: number, details: string[] }> {
    console.log(`🗑️ Bắt đầu xóa ${employeeIds.length} mã nhân viên dư thừa...`);
    
    let successCount = 0;
    let errorCount = 0;
    const details: string[] = [];
    
    const collectionsToClean = [
      'inbound-materials',
      'outbound-materials', 
      'materials-asm1',
      'materials-asm2',
      'work-orders',
      'shipment-items',
      'label-schedules',
      'safety-materials',
      'training-reports',
      'audit-logs'
    ];

    for (const empId of employeeIds) {
      try {
        console.log(`🔄 Đang xóa mã nhân viên: ${empId}...`);
        let totalUpdated = 0;
        
        for (const collectionName of collectionsToClean) {
          try {
            const snapshot = await this.firestore.collection(collectionName).get().toPromise();
            const batch = this.firestore.firestore.batch();
            let batchCount = 0;
            
            snapshot?.forEach(doc => {
              const data = doc.data();
              const employeeFields = ['employeeId', 'exportedBy', 'createdBy', 'checkedBy', 'performedBy', 'scannedBy'];
              
              let hasEmployeeId = false;
              const updateData: any = {};
              
              employeeFields.forEach(field => {
                if (data[field] === empId) {
                  hasEmployeeId = true;
                  updateData[field] = 'DELETED_EMPLOYEE';
                }
              });
              
              if (hasEmployeeId) {
                batch.update(doc.ref, updateData);
                batchCount++;
              }
            });
            
            if (batchCount > 0) {
              await batch.commit();
              totalUpdated += batchCount;
              console.log(`  ✅ ${collectionName}: Cập nhật ${batchCount} documents`);
            }
          } catch (error) {
            console.log(`  ⚠️ Lỗi khi xóa từ ${collectionName}:`, error);
          }
        }
        
        successCount++;
        details.push(`✅ ${empId}: Cập nhật ${totalUpdated} documents`);
        console.log(`✅ Đã xóa thành công: ${empId} (${totalUpdated} documents)\n`);
        
      } catch (error) {
        errorCount++;
        details.push(`❌ ${empId}: Lỗi - ${error}`);
        console.log(`❌ Lỗi khi xóa ${empId}:`, error);
      }
    }
    
    console.log(`\n📊 KẾT QUẢ XÓA:`);
    console.log(`✅ Thành công: ${successCount}`);
    console.log(`❌ Lỗi: ${errorCount}`);
    
    return {
      success: successCount,
      errors: errorCount,
      details: details
    };
  }

  /**
   * Xuất báo cáo Excel so sánh mã nhân viên
   */
  exportComparisonReport(result: CleanupResult): void {
    console.log('📊 Tạo báo cáo Excel...');
    console.log('Result data:', result);
    
    // Tạo dữ liệu cho Excel
    const excelData = this.createExcelData(result);
    console.log('Excel data:', excelData);
    
    // Tạo file Excel
    this.generateExcelFile(excelData, result);
  }

  /**
   * Tạo dữ liệu cho Excel - CHỈ mã nhân viên format ASP + 4 số
   */
  private createExcelData(result: CleanupResult): any[] {
    const data: any[] = [];
    
    // Header
    data.push({
      'STT': 'STT',
      'Mã nhân viên Settings': 'Mã nhân viên Settings',
      'Mã nhân viên Firebase': 'Mã nhân viên Firebase',
      'Trạng thái': 'Trạng thái',
      'Ghi chú': 'Ghi chú'
    });
    
    let stt = 1;
    
    // 1. Mã nhân viên dư thừa (có trong Firebase nhưng không có trong Settings)
    // CHỈ lấy mã đúng format ASP + 4 số
    result.redundantEmployees.forEach(emp => {
      if (emp.employeeId && emp.employeeId.match(/^ASP\d{4}$/i)) {
        data.push({
          'STT': stt++,
          'Mã nhân viên Settings': '',
          'Mã nhân viên Firebase': emp.employeeId.toUpperCase(),
          'Trạng thái': 'Dư thừa',
          'Ghi chú': 'Có trong Firebase, không có trong Settings'
        });
      }
    });
    
    // 2. Mã nhân viên thiếu (có trong Settings nhưng không có trong Firebase)
    // CHỈ lấy mã đúng format ASP + 4 số
    result.missingEmployees.forEach(empId => {
      if (empId && empId.match(/^ASP\d{4}$/i)) {
        data.push({
          'STT': stt++,
          'Mã nhân viên Settings': empId.toUpperCase(),
          'Mã nhân viên Firebase': '',
          'Trạng thái': 'Thiếu',
          'Ghi chú': 'Có trong Settings, không có trong Firebase'
        });
      }
    });
    
    console.log(`📊 Tạo báo cáo Excel: ${data.length - 1} dòng dữ liệu (ASP + 4 số)`);
    return data;
  }

  /**
   * Tạo file Excel với giao diện trắng đen
   */
  private generateExcelFile(data: any[], result: CleanupResult): void {
    console.log('🔍 Kiểm tra XLSX library...');
    console.log('window.XLSX:', (window as any).XLSX);
    console.log('typeof XLSX:', typeof (window as any).XLSX);
    
    // Import XLSX library
    const XLSX = (window as any).XLSX;
    
    if (!XLSX) {
      console.error('❌ XLSX library not found. Please include xlsx library.');
      console.log('Available window properties:', Object.keys(window).filter(key => key.toLowerCase().includes('xlsx')));
      alert('❌ Không tìm thấy thư viện XLSX. Vui lòng thêm thư viện xlsx.');
      return;
    }
    
    console.log('✅ XLSX library found:', XLSX);

    try {
      // Tạo workbook
      const wb = XLSX.utils.book_new();
      
      // Tạo worksheet
      const ws = XLSX.utils.json_to_sheet(data);
      
      // Thiết lập column widths
      ws['!cols'] = [
        { wch: 8 },   // STT
        { wch: 25 },  // Mã nhân viên Settings
        { wch: 25 },  // Mã nhân viên Firebase
        { wch: 15 },  // Trạng thái
        { wch: 40 }   // Ghi chú
      ];
      
      // Thêm worksheet vào workbook
      XLSX.utils.book_append_sheet(wb, ws, 'So sánh mã nhân viên');
      
      // Tạo tên file với timestamp
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `BaoCao_SoSanh_MaNhanVien_${timestamp}.xlsx`;
      
      // Xuất file
      XLSX.writeFile(wb, filename);
      
      console.log('✅ Đã xuất báo cáo Excel:', filename);
      alert(`✅ Đã tạo file Excel: ${filename}`);
      
    } catch (error) {
      console.error('❌ Lỗi khi tạo file Excel:', error);
      console.log('Error details:', error);
      
      // Fallback: Tạo file CSV
      this.createCSVFallback(data);
    }
  }

  /**
   * Fallback: Tạo file CSV nếu Excel không hoạt động
   */
  private createCSVFallback(data: any[]): void {
    try {
      console.log('🔄 Tạo file CSV fallback...');
      
      // Tạo CSV content
      const headers = ['STT', 'Mã nhân viên Settings', 'Mã nhân viên Firebase', 'Trạng thái', 'Ghi chú'];
      const csvContent = [
        headers.join(','),
        ...data.map(row => [
          row['STT'] || '',
          `"${row['Mã nhân viên Settings'] || ''}"`,
          `"${row['Mã nhân viên Firebase'] || ''}"`,
          `"${row['Trạng thái'] || ''}"`,
          `"${row['Ghi chú'] || ''}"`
        ].join(','))
      ].join('\n');
      
      // Tạo blob và download
      const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      
      link.setAttribute('href', url);
      const timestamp = new Date().toISOString().split('T')[0];
      link.setAttribute('download', `BaoCao_SoSanh_MaNhanVien_${timestamp}.csv`);
      link.style.visibility = 'hidden';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      console.log('✅ Đã tạo file CSV fallback');
      alert('✅ Đã tạo file CSV (Excel không khả dụng)');
      
    } catch (error) {
      console.error('❌ Lỗi khi tạo file CSV:', error);
      alert('❌ Không thể tạo file báo cáo!');
    }
  }
}
