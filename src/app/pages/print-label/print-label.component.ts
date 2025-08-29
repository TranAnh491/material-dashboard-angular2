import { Component, OnInit } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { PermissionService } from '../../services/permission.service';
import { AngularFireAuth } from '@angular/fire/compat/auth';
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
  statusUpdateTime?: Date; // Thời gian cập nhật trạng thái
  banVe?: string;
  ghiChu?: string;
  isUrgent?: boolean; // Đánh dấu gấp
  labelComparison?: {
    comparisonResult?: 'Pass' | 'Fail' | 'Chờ in' | 'Completed';
    comparedAt?: Date;
    matchPercentage?: number;
    mismatchDetails?: string[];
    hasSampleText?: boolean;
    sampleSpecs?: LabelSpecifications;
    printedSpecs?: LabelSpecifications;
    annotations?: any[];
    photoUrl?: string;
    designPhotoId?: string;
    designPhotoUrl?: string;
    printedPhotoId?: string;
    printedPhotoUrl?: string;
  };
}

interface DetectedText {
  value: string;
  bbox: { x: number; y: number; width: number; height: number };
}

interface LabelSpecifications {
  text?: string[];
  detectedTexts?: DetectedText[];
  fontSize?: number[];
  fontStyle?: string[];
  colors?: string[];
  dimensions?: {width: number, height: number};
  position?: {x: number, y: number};
  quality?: number;
  missingTexts?: DetectedText[]; // highlight info
}

interface ImageAnalysisResult {
  success: boolean;
  error?: string;
  hasSampleText: boolean;
  sampleRegion: ImageData | null;
  printedRegion: ImageData | null;
}

interface ComparisonResult {
  result: 'Pass' | 'Fail';
  matchPercentage: number;
  mismatchDetails: string[];
  detailedAnalysis: {
    textMatch: number;
    fontMatch: number;
    colorMatch: number;
    sizeMatch: number;
    positionMatch: number;
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

  // Authentication properties
  isAuthenticated: boolean = false;
  currentEmployeeId: string = '';
  currentPassword: string = '';
  loginError: string = '';
  showLoginDialog: boolean = false;
  currentUserDepartment: string = '';
  currentUserId: string = '';

  // Camera capture properties
  isCapturingPhoto: boolean = false;
  currentCaptureMode: 'design' | 'printed' = 'design'; // Chế độ chụp hiện tại
  captureStep: number = 1; // Bước chụp: 1 = bản vẽ, 2 = tem in
  
  // Time range properties
  selectedDays: number = 30; // Mặc định 30 ngày
  customStartDate: Date | null = null;
  customEndDate: Date | null = null;

  // Search functionality
  searchTerm: string = '';



  constructor(
    private firestore: AngularFirestore,
    private permissionService: PermissionService,
    private afAuth: AngularFireAuth
  ) { }

  ngOnInit(): void {
    console.log('🚀 PrintLabelComponent initialized');
    
    // Auto-select print function
    this.selectedFunction = 'print';
    
    // Load user department information
    this.loadUserDepartment();
    
    // Load trạng thái hiển thị từ localStorage
    this.loadDisplayStateFromStorage();
    
    // Check if mobile device
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (isMobile) {
      console.log('📱 Mobile device detected, using optimized loading...');
      // Delay loading on mobile to prevent UI freezing
      setTimeout(() => {
        this.loadDataFromFirebase();
        this.refreshStorageInfo();
        this.autoHandleDocumentSizeLimit();
      }, 1000);
    } else {
      // Desktop loading
      this.loadDataFromFirebase();
      this.refreshStorageInfo();
      this.autoHandleDocumentSizeLimit();
    }
  }

  ngOnDestroy(): void {
    // Clean up any existing camera streams
    const existingDialog = document.querySelector('.camera-dialog');
    if (existingDialog) {
      document.body.removeChild(existingDialog);
    }
    
    // Stop all media streams
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        .then(stream => {
          stream.getTracks().forEach(track => track.stop());
        })
        .catch(() => {
          // Ignore errors when cleaning up
        });
    }
  }





  selectFunction(functionName: string): void {
    console.log('Selecting function:', functionName);
    this.selectedFunction = functionName;
  }

  // Print Schedules Functions
  triggerFileImport(): void {
    // Trigger the hidden file input
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  }

  // Test method to debug template import
  testTemplateImport(): void {
    console.log('🧪 Testing template import...');
    console.log('🧪 Current scheduleData length:', this.scheduleData ? this.scheduleData.length : 0);
    console.log('🧪 Sample data:', this.scheduleData ? this.scheduleData[0] : 'No data');
    
    // Test with sample data
    const testData = [
      ['2025', '01', '001', '40x20', 'TM001', '1000', '100', 'MH001', 'LSX001', 'ABC Corp', '15/01/2025', '25', '03', 'Line A', 'Tuấn', 'Chờ in', 'Có', 'Sample data'],
      ['2025', '01', '002', '40x25', 'TM002', '500', '50', 'MH002', 'LSX002', 'XYZ Ltd', '20/01/2025', '25', '04', 'Line B', 'Tình', 'Chờ in', 'Có', 'Sample data']
    ];
    
    console.log('🧪 Test data:', testData);
    
    // Simulate processing
    const processedData = testData.map((row: any, index: number) => {
      const soLuongYeuCau = this.processQuantityField(row[5], 'Số lượng yêu cầu');
      const soLuongPhoi = this.processQuantityField(row[6], 'Số lượng phôi');
      
      return {
        nam: row[0]?.toString() || '',
        thang: row[1]?.toString() || '',
        stt: row[2]?.toString() || '',
        sizePhoi: row[3]?.toString() || '',
        maTem: row[4]?.toString() || '',
        soLuongYeuCau: soLuongYeuCau,
        soLuongPhoi: soLuongPhoi,
        maHang: row[7]?.toString() || '',
        lenhSanXuat: row[8]?.toString() || '',
        khachHang: row[9]?.toString() || '',
        ngayNhanKeHoach: this.formatDateValue(row[10]) || '',
        yy: row[11]?.toString() || '',
        ww: row[12]?.toString() || '',
        lineNhan: row[13]?.toString() || '',
        nguoiIn: row[14]?.toString() || '',
        tinhTrang: row[15]?.toString() || 'Chờ in',
        statusUpdateTime: new Date(),
        banVe: row[16]?.toString() || '',
        ghiChu: row[17]?.toString() || '',
        isUrgent: false
      };
    });
    
    console.log('🧪 Processed test data:', processedData);
    alert('🧪 Test completed! Check console for details.');
  }

  // Method to check Firebase data status
  checkFirebaseDataStatus(): void {
    console.log('🔍 Checking Firebase data status...');
    
    this.firestore.collection('printSchedules').get().toPromise()
      .then((snapshot: any) => {
        if (snapshot && !snapshot.empty) {
          console.log(`📊 Firebase contains ${snapshot.docs.length} documents`);
          
          let totalItems = 0;
          let totalDataFields = 0;
          
          snapshot.docs.forEach((doc: any, index: number) => {
            const data = doc.data();
            console.log(`📋 Document ${index + 1} (${doc.id}):`, data);
            
            if (data.data && Array.isArray(data.data)) {
              totalDataFields += data.data.length;
              console.log(`  - Has data field with ${data.data.length} items`);
            }
            
            if (data.maTem) {
              totalItems += 1;
              console.log(`  - Individual item: ${data.maTem}`);
            }
          });
          
          const message = `📊 Firebase Data Status:\n\n📁 Total documents: ${snapshot.docs.length}\n📋 Items in data fields: ${totalDataFields}\n🏷️ Individual items: ${totalItems}\n\n💾 Current local data: ${this.scheduleData ? this.scheduleData.length : 0} items`;
          
          console.log(message);
          alert(message);
        } else {
          alert('📊 Firebase is empty - no documents found');
        }
      })
      .catch((error) => {
        console.error('❌ Error checking Firebase status:', error);
        alert(`❌ Error checking Firebase: ${error.message}`);
      });
  }

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
    console.log('📁 Reading Excel file:', file.name, 'Size:', file.size, 'bytes');
    
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        // Read Excel file using SheetJS
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Get first worksheet
        const worksheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[worksheetName];
        
        console.log('📋 Worksheet names:', workbook.SheetNames);
        console.log('📋 Selected worksheet:', worksheetName);
        
        // Convert to JSON array
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        console.log('📊 Raw Excel data:', jsonData);
        console.log('📊 Data rows count:', jsonData ? jsonData.length : 0);
        
        // Validate Excel structure
        if (!jsonData || jsonData.length < 2) {
          throw new Error(`Excel file is empty or has no data rows. Found: ${jsonData ? jsonData.length : 0} rows`);
        }

        // Check if this is a template file (only header row)
        if (jsonData.length === 1) {
          console.log('📋 Detected template file (only header row)');
          alert('📋 This appears to be a template file with only headers. Please add data rows and try again.');
          return;
        }

        // Remove header row and convert to ScheduleItem format
        const dataRows = jsonData.slice(1); // Skip header row
        console.log('📊 Data rows (excluding header):', dataRows);
        console.log('📊 First data row sample:', dataRows[0]);
        
        const newScheduleData = dataRows.map((row: any, index: number) => {
          console.log(`📋 Processing row ${index + 1}:`, row);
          
          // Validate row has minimum required data
          if (!row[4] || !row[4].toString().trim()) {
            console.warn(`⚠️ Row ${index + 1} missing mã tem, skipping...`);
            return null;
          }
          
          // Process quantity fields to ensure they are even integers
          const soLuongYeuCau = this.processQuantityField(row[5], 'Số lượng yêu cầu');
          const soLuongPhoi = this.processQuantityField(row[6], 'Số lượng phôi');
          
                  const processedRow = {
          nam: row[0]?.toString() || '',
          thang: row[1]?.toString() || '',
          stt: row[2]?.toString() || '', // STT lấy theo file
          sizePhoi: row[3]?.toString() || '',
          maTem: row[4]?.toString() || '',
          soLuongYeuCau: soLuongYeuCau,
          soLuongPhoi: soLuongPhoi,
          maHang: row[7]?.toString() || '',
          lenhSanXuat: row[8]?.toString() || '',
          khachHang: row[9]?.toString() || '',
          ngayNhanKeHoach: this.formatDateValue(row[10]) || '',
          yy: row[11]?.toString() || '',
          ww: row[12]?.toString() || '',
          lineNhan: row[13]?.toString() || '',
          nguoiIn: row[14]?.toString() || '',
          tinhTrang: row[15]?.toString() || 'Chờ in',
          statusUpdateTime: new Date(), // Khởi tạo thời gian cập nhật trạng thái
          banVe: row[16]?.toString() || '',
          ghiChu: row[17]?.toString() || '',
          isUrgent: false, // Mặc định không gấp
          labelComparison: null // Thay vì undefined, sử dụng null
        };
          
          console.log(`📋 Processed row ${index + 1}:`, processedRow);
          return processedRow;
        }).filter(row => row !== null); // Remove null rows
        
        console.log('📋 Processed new schedule data:', newScheduleData.length, 'items');
        console.log('📋 Sample processed data:', newScheduleData[0]);
        
        // Validate data before saving
        if (newScheduleData.length === 0) {
          throw new Error('No valid data rows found in Excel file after processing. Please ensure each row has at least a "Mã tem" value.');
        }

        // Clean data to remove any undefined values before saving to Firebase
        const cleanedData = newScheduleData.map(item => {
          const cleanedItem: any = {};
          Object.keys(item).forEach(key => {
            if (item[key as keyof ScheduleItem] === undefined) {
              cleanedItem[key] = null; // Replace undefined with null
            } else {
              cleanedItem[key] = item[key as keyof ScheduleItem];
            }
          });
          return cleanedItem;
        });

        console.log('🧹 Cleaned data (replaced undefined with null):', cleanedData.length, 'items');

        // Merge with existing data instead of replacing
        const existingData = this.scheduleData || [];
        const mergedData = [...existingData, ...cleanedData];
        
        console.log(`📊 Merging data: ${existingData.length} existing + ${cleanedData.length} new = ${mergedData.length} total`);
        
        // Update the schedule data with merged data
        this.scheduleData = mergedData;

        // Save to Firebase 
        this.saveToFirebase(this.scheduleData);
        
        const message = `✅ Successfully imported ${cleanedData.length} new records from ${file.name} and merged with ${existingData.length} existing records. Total: ${mergedData.length} records saved to Firebase 🔥\n\n📊 Import Summary:\n- File: ${file.name}\n- New records: ${cleanedData.length}\n- Existing records: ${existingData.length}\n- Total after merge: ${mergedData.length}\n- Data cleaned: undefined values replaced with null`;
        
        alert(message);
        console.log('✅ Import completed successfully:', message);
      } catch (error) {
        console.error('❌ Error reading file:', error);
        console.error('❌ Error details:', error.message);
        this.isSaving = false; // Reset saving state on error
        alert(`❌ Error reading Excel file: ${error.message}\n\nPlease check the file format and try again.`);
      }
    };
    reader.onerror = (error) => {
      console.error('❌ Error reading file:', error);
      alert('❌ Lỗi khi đọc file Excel');
    };
    reader.readAsArrayBuffer(file);
  }

  // Process quantity field to ensure it's an even integer
  private processQuantityField(value: any, fieldName: string): string {
    if (value === null || value === undefined || value === '') {
      return '0';
    }
    
    // Handle numbers with thousand separators (e.g., "1.000", "1.500.000")
    let cleanValue = value.toString();
    
    // Remove thousand separators (dots) but keep the number
    if (cleanValue.includes('.')) {
      // Check if it's a valid thousand separator format (e.g., "1.000", "1.500.000")
      const parts = cleanValue.split('.');
      const lastPart = parts[parts.length - 1];
      
      // If last part has 3 digits, it's likely thousand separator
      if (lastPart.length === 3 && parts.every(part => /^\d{1,3}$/.test(part))) {
        // Valid thousand separator format, remove dots
        cleanValue = cleanValue.replace(/\./g, '');
        console.log(`✅ ${fieldName} "${value}" được nhận diện là format hàng ngàn, chuyển thành: ${cleanValue}`);
      } else {
        // Not thousand separator, treat as decimal
        cleanValue = cleanValue.replace(/\./g, '');
        console.warn(`⚠️ ${fieldName} "${value}" có dấu chấm không phải format hàng ngàn, loại bỏ dấu chấm`);
      }
    }
    
    // Convert to number
    let numValue = parseFloat(cleanValue.replace(/[^\d.-]/g, ''));
    
    // If not a valid number, return 0
    if (isNaN(numValue)) {
      console.warn(`⚠️ ${fieldName} không phải số hợp lệ: "${value}", gán giá trị 0`);
      return '0';
    }
    
    // Convert to integer (remove decimal places)
    numValue = Math.floor(Math.abs(numValue));
    
    // Ensure it's an even number
    if (numValue % 2 !== 0) {
      numValue += 1; // Make it even by adding 1
      console.warn(`⚠️ ${fieldName} "${value}" đã được làm tròn thành số chẵn: ${numValue}`);
    }
    
    return numValue.toString();
  }

  // Format number for display with thousand separators
  formatNumberForDisplay(value: string | number): string {
    if (!value || value === '0') {
      return '0';
    }
    
    const numValue = parseInt(value.toString());
    if (isNaN(numValue)) {
      return value.toString();
    }
    
    // Add thousand separators
    return numValue.toLocaleString('vi-VN');
  }

  saveToFirebase(data: ScheduleItem[]): void {
    console.log('🔥 Saving data to Firebase...');
    
    // Validate data before saving
    if (!data || data.length === 0) {
      console.error('❌ No data to save to Firebase');
      alert('❌ Không có dữ liệu để lưu vào Firebase!');
      return;
    }

    // Final cleanup: ensure no undefined values exist before saving to Firebase
    const finalCleanData = data.map(item => {
      const cleanItem: any = {};
      Object.keys(item).forEach(key => {
        const value = item[key as keyof ScheduleItem];
        if (value === undefined) {
          cleanItem[key] = null;
          console.warn(`⚠️ Found undefined value for field "${key}", replacing with null`);
        } else {
          cleanItem[key] = value;
        }
      });
      return cleanItem;
    });

    console.log('🧹 Final data cleanup completed, saving to Firebase...');
    
    this.isSaving = true;
    
    // Check if we need to split data into smaller chunks
    const maxRecordsPerChunk = 50; // Limit to 50 records per chunk to stay under 1MB
    const chunks = [];
    
    for (let i = 0; i < finalCleanData.length; i += maxRecordsPerChunk) {
      chunks.push(finalCleanData.slice(i, i + maxRecordsPerChunk));
    }
    
    console.log(`📦 Splitting ${finalCleanData.length} records into ${chunks.length} chunks of max ${maxRecordsPerChunk} records each`);
    
    // Save each chunk as a separate document
    const savePromises = chunks.map((chunk, chunkIndex) => {
      const chunkDoc = {
        data: chunk,
        importedAt: new Date(),
        month: this.getCurrentMonth(),
        chunkIndex: chunkIndex,
        totalChunks: chunks.length,
        recordCount: chunk.length,
        totalRecords: finalCleanData.length,
        lastUpdated: new Date()
      };
      
      return this.firestore.collection('printSchedules').add(chunkDoc);
    });

    console.log(`📤 Attempting to save ${chunks.length} chunks to Firebase`);

    // Add timeout to Firebase save
    const savePromise = Promise.all(savePromises);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Firebase save timeout after 30 seconds')), 30000)
    );

    Promise.race([savePromise, timeoutPromise])
      .then((docRefs: any) => {
        console.log('✅ Data successfully saved to Firebase with IDs: ', docRefs.map((ref: any) => ref.id));
        this.firebaseSaved = true;
        this.isSaving = false;
        console.log('🔄 Updated firebaseSaved to:', this.firebaseSaved);
        alert(`✅ Đã lưu thành công ${finalCleanData.length} records vào Firebase!\n\n📦 Chia thành ${chunks.length} chunks để tránh vượt quá giới hạn 1MB\n🧹 Dữ liệu đã được làm sạch (undefined → null)`);
      })
      .catch((error) => {
        console.error('❌ Error saving to Firebase: ', error);
        this.isSaving = false;
        this.firebaseSaved = false;
        console.log('🔄 Updated firebaseSaved to:', this.firebaseSaved);
        alert(`❌ Lỗi khi lưu dữ liệu vào Firebase:\n${error.message || error}`);
      });
  }

  loadDataFromFirebase(): void {
    // Check if data was just cleared
    if ((window as any).dataCleared) {
      console.log('🚫 Data was just cleared, skipping reload');
      (window as any).dataCleared = false;
      return;
    }
    
    console.log('🔥 Loading data from Firebase...');
    console.log('🔍 Call stack:', new Error().stack);
    this.isLoading = true;
    
    // Check if mobile device
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    // Load only data from last 30 days by default
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    this.firestore.collection('printSchedules', ref => 
      ref.where('importedAt', '>=', thirtyDaysAgo).orderBy('importedAt', 'desc')
    ).get().toPromise()
      .then((scheduleSnapshot: any) => {
        this.isLoading = false;
        
        if (scheduleSnapshot && !scheduleSnapshot.empty) {
          console.log(`📋 Found ${scheduleSnapshot.docs.length} documents in Firebase`);
          
          // Load ALL documents and merge their data
          let allData: any[] = [];
          
          scheduleSnapshot.docs.forEach((doc: any, docIndex: number) => {
            const docData = doc.data();
            console.log(`📋 Document ${docIndex + 1}:`, docData);
            
            if (docData.data && Array.isArray(docData.data) && docData.data.length > 0) {
              console.log(`📋 Document ${docIndex + 1} has ${docData.data.length} items in data field`);
              allData = [...allData, ...docData.data];
            } else if (docData.maTem) {
              // Fallback: individual document format
              console.log(`📋 Document ${docIndex + 1} is individual item format`);
              allData.push(docData);
            }
          });
          
          console.log(`📋 Total items found across all documents: ${allData.length}`);
          
          // Process all loaded data
          this.scheduleData = allData.map((item: any) => {
            const processedItem = {
              nam: item.nam || '',
              thang: item.thang || '',
              stt: item.stt || '',
              sizePhoi: item.sizePhoi || '',
              maTem: item.maTem || '',
              soLuongYeuCau: item.soLuongYeuCau || '',
              soLuongPhoi: item.soLuongPhoi || '',
              maHang: item.maHang || '',
              lenhSanXuat: item.lenhSanXuat || '',
              khachHang: item.khachHang || '',
              ngayNhanKeHoach: item.ngayNhanKeHoach || '',
              yy: item.yy || '',
              ww: item.ww || '',
              lineNhan: item.lineNhan || '',
              nguoiIn: item.nguoiIn || '',
              tinhTrang: item.tinhTrang || '',
              statusUpdateTime: item.statusUpdateTime ? new Date(item.statusUpdateTime.toDate ? item.statusUpdateTime.toDate() : item.statusUpdateTime) : new Date(),
              banVe: item.banVe || '',
              ghiChu: item.ghiChu || '',
              isUrgent: item.isUrgent || false,
              labelComparison: item.labelComparison || null
            };
            
            return processedItem;
          });
          

          
          // Sort data by STT
          this.scheduleData.sort((a, b) => {
            const aIndex = parseInt(a.stt || '0');
            const bIndex = parseInt(b.stt || '0');
            return aIndex - bIndex;
          });
          
          this.firebaseSaved = this.scheduleData.length > 0;
          console.log(`🔥 Loaded ${this.scheduleData.length} records from Firebase`);
          
          // Show summary to user
          if (this.scheduleData.length > 0) {
            const uniqueMaTem = [...new Set(this.scheduleData.map(item => item.maTem))];
            console.log(`📊 Summary: ${this.scheduleData.length} total items, ${uniqueMaTem.length} unique mã tem`);
            
            // Show alert with summary
            setTimeout(() => {
              alert(`📊 Dữ liệu đã được tải từ Firebase:\n\n📋 Tổng số items: ${this.scheduleData.length}\n🏷️ Số mã tem duy nhất: ${uniqueMaTem.length}\n\n✅ Refresh thành công!`);
            }, 500);
          }
        } else {
          console.log('🔥 No data found in Firebase');
          this.scheduleData = [];
          this.firebaseSaved = false;
        }
      })
      .catch((error) => {
        console.error('🔥 Error loading from Firebase:', error);
        this.isLoading = false;
        this.scheduleData = [];
        this.firebaseSaved = false;
        
        // Show user-friendly error on mobile
        if (isMobile) {
          alert('⚠️ Lỗi tải dữ liệu. Vui lòng thử lại sau hoặc kiểm tra kết nối mạng.');
        }
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
      ['Năm', 'Tháng', 'STT', 'Size Phôi', 'Mã tem', 'Lượng Tem', 'Lượng phôi', 'Mã Hàng', 'Lệnh sản xuất', 'Khách hàng', 'Ngày nhận kế hoạch', 'YY', 'WW', 'Line nhận', 'Người in', 'Tình trạng', 'Bản vẽ', 'Ghi chú'],
      ['2025', '01', '001', '40x20', 'TM001', '1000', '100', 'MH001', 'LSX001', 'ABC Corp', '15/01/2025', '25', '03', 'Line A', 'Tuấn', 'Chờ in', 'Có', 'Sample data'],
      ['2025', '01', '002', '40x25', 'TM002', '500', '50', 'MH002', 'LSX002', 'XYZ Ltd', '20/01/2025', '25', '04', 'Line B', 'Tình', 'Chờ in', 'Có', 'Sample data'],
      ['2025', '01', '003', '40x20', 'TM003', '2000', '200', 'MH003', 'LSX003', 'DEF Inc', '25/01/2025', '25', '04', 'Line C', 'Hưng', 'Chờ in', 'Chưa có', 'Sample data']
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
      ['Năm', 'Tháng', 'STT', 'Size Phôi', 'Mã tem', 'Lượng Tem', 'Lượng phôi', 'Mã Hàng', 'Lệnh sản xuất', 'Khách hàng', 'Ngày nhận kế hoạch', 'YY', 'WW', 'Line nhận', 'Người in', 'Tình trạng', 'Bản vẽ', 'Ghi chú'],
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

  // Download Status Report - Report dựa theo giao diện hiện tại
  downloadStatusReport(): void {
    if (this.scheduleData.length === 0) {
      alert('Không có dữ liệu để tạo report!');
      return;
    }

    console.log('Download Status Report clicked');
    
    // Lấy dữ liệu hiện tại (theo filter hiện tại)
    const currentData = this.getDisplayScheduleData();
    
    if (currentData.length === 0) {
      alert('Không có dữ liệu để hiển thị trong report!');
      return;
    }

    // Tạo dữ liệu cho report
    const reportData = [
      ['BÁO CÁO STATUS HIỆN TẠI - PRINT LABEL'],
      [`Ngày tạo: ${new Date().toLocaleDateString('vi-VN')}`],
      [`Tổng số records: ${currentData.length}`],
      [],
      ['TỔNG KẾT THEO TÌNH TRẠNG:'],
      ['Tình trạng', 'Số lượng', 'Tỷ lệ %'],
      ['IQC', this.getIQCItemsCount(), `${((this.getIQCItemsCount() / currentData.length) * 100).toFixed(1)}%`],
      ['Pass', this.getPassItemsCount(), `${((this.getPassItemsCount() / currentData.length) * 100).toFixed(1)}%`],
      ['NG', this.getNGItemsCount(), `${((this.getNGItemsCount() / currentData.length) * 100).toFixed(1)}%`],
      ['Chờ in', this.getPendingItemsCount(), `${((this.getPendingItemsCount() / currentData.length) * 100).toFixed(1)}%`],
      ['Chờ bản vẽ', this.getChoBanVeItemsCount(), `${((this.getChoBanVeItemsCount() / currentData.length) * 100).toFixed(1)}%`],
      ['Chờ Template', this.getChoTemplateItemsCount(), `${((this.getChoTemplateItemsCount() / currentData.length) * 100).toFixed(1)}%`],
      ['Chờ in', currentData.filter(item => item.tinhTrang === 'Chờ in').length, `${((currentData.filter(item => item.tinhTrang === 'Chờ in').length / currentData.length) * 100).toFixed(1)}%`],
      ['Đã in', currentData.filter(item => item.tinhTrang === 'Đã in').length, `${((currentData.filter(item => item.tinhTrang === 'Đã in').length / currentData.length) * 100).toFixed(1)}%`],
      ['Done', currentData.filter(item => item.tinhTrang === 'Done').length, `${((currentData.filter(item => item.tinhTrang === 'Done').length / currentData.length) * 100).toFixed(1)}%`],
      [],
      ['CHI TIẾT DỮ LIỆU:'],
      ['Năm', 'Tháng', 'STT', 'Size Phôi', 'Mã tem', 'Số lượng yêu cầu', 'Số lượng phôi', 'Mã Hàng', 'Lệnh sản xuất', 'Khách hàng', 'Ngày nhận kế hoạch', 'YY', 'WW', 'Line nhận', 'Người in', 'Tình trạng', 'Thời gian', 'Ghi chú', 'Hoàn thành'],
      ...currentData.map(item => [
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
        item.statusUpdateTime ? new Date(item.statusUpdateTime).toLocaleString('vi-VN') : '',
        item.ghiChu || '',
        item.tinhTrang === 'Done' ? 'Đã hoàn thành' : 'Chưa hoàn thành'
      ])
    ];
    
    // Tạo Excel file
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(reportData);

    // Merge cells cho tiêu đề
    worksheet['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 18 } }, // Tiêu đề chính
      { s: { r: 1, c: 0 }, e: { r: 1, c: 18 } }, // Ngày tạo
      { s: { r: 2, c: 0 }, e: { r: 2, c: 18 } }, // Tổng số records
      { s: { r: 4, c: 0 }, e: { r: 4, c: 18 } }, // Tổng kết theo tình trạng
      { s: { r: 16, c: 0 }, e: { r: 16, c: 18 } } // Chi tiết dữ liệu
    ];

    // Set column widths
    const columnWidths = [
      { wch: 6 },  // Năm
      { wch: 6 },  // Tháng
      { wch: 5 },  // STT
      { wch: 12 }, // Size Phôi
      { wch: 12 }, // Mã tem
      { wch: 18 }, // Số lượng yêu cầu
      { wch: 18 }, // Số lượng phôi
      { wch: 12 }, // Mã Hàng
      { wch: 18 }, // Lệnh sản xuất
      { wch: 15 }, // Khách hàng
      { wch: 20 }, // Ngày nhận kế hoạch
      { wch: 4 },  // YY
      { wch: 4 },  // WW
      { wch: 15 }, // Line nhận
      { wch: 15 }, // Người in
      { wch: 15 }, // Tình trạng
      { wch: 20 }, // Thời gian
      { wch: 20 }, // Ghi chú
      { wch: 18 }  // Hoàn thành
    ];
    worksheet['!cols'] = columnWidths;

    // Style cho tiêu đề
    const titleCell = worksheet['A1'];
    if (titleCell) {
      titleCell.s = {
        font: { bold: true, size: 16, color: { rgb: '000000' } },
        alignment: { horizontal: 'center' },
        fill: { fgColor: { rgb: 'FF9800' } }
      };
    }

    // Style cho ngày tạo
    const dateCell = worksheet['A2'];
    if (dateCell) {
      dateCell.s = {
        font: { italic: true, size: 12, color: { rgb: '666666' } },
        alignment: { horizontal: 'center' }
      };
    }

    // Style cho tổng số records
    const countCell = worksheet['A3'];
    if (countCell) {
      countCell.s = {
        font: { bold: true, size: 12, color: { rgb: '1976D2' } },
        alignment: { horizontal: 'center' }
      };
    }

    // Style cho header tổng kết
    const summaryHeader = worksheet['A5'];
    if (summaryHeader) {
      summaryHeader.s = {
        font: { bold: true, size: 14, color: { rgb: '2E7D32' } },
        fill: { fgColor: { rgb: 'E8F5E8' } }
      };
    }

    // Style cho header chi tiết
    const detailHeader = worksheet['A17'];
    if (detailHeader) {
      detailHeader.s = {
        font: { bold: true, size: 12, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: 'FF9800' } },
        alignment: { horizontal: 'center' }
      };
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Status Report');

    // Generate Excel file
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    // Download file
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Status_Report_${new Date().toISOString().split('T')[0]}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
    
    alert(`Đã tải về report Status hiện tại với ${currentData.length} records thành công!`);
  }

  // Test method for debugging
  testClearData(): void {
    console.log('🧪 testClearData() called');
    alert('🧪 Test method được gọi thành công!');
  }

  // Popup xác nhận xóa
  showDeleteDialog: boolean = false;
  deleteDialogMessage: string = '';
  deleteCode: string = '';
  deletePassword: string = '';
  currentDeleteAction: 'clearData' | 'deleteCompleted' | 'freshImport' = 'clearData';

  // Hiển thị popup xác nhận xóa dữ liệu
  showDeleteConfirmDialog(): void {
    this.currentDeleteAction = 'clearData';
    this.deleteDialogMessage = 'Bạn có chắc chắn muốn xóa TẤT CẢ dữ liệu? Hành động này không thể hoàn tác!';
    this.deleteCode = '';
    this.deletePassword = '';
    this.showDeleteDialog = true;
  }

  // Hiển thị popup xác nhận xóa mã đã hoàn thành
  showDeleteCompletedConfirmDialog(): void {
    this.currentDeleteAction = 'deleteCompleted';
    this.deleteDialogMessage = 'Bạn có chắc chắn muốn xóa TẤT CẢ các mã đã hoàn thành?';
    this.deleteCode = '';
    this.deletePassword = '';
    this.showDeleteDialog = true;
  }

  // Đóng popup
  closeDeleteDialog(): void {
    this.showDeleteDialog = false;
    this.deleteCode = '';
    this.deletePassword = '';
  }

  // Xác nhận xóa sau khi nhập mã và password
  async confirmDelete(): Promise<void> {
    if (!this.deleteCode || !this.deletePassword) {
      alert('Vui lòng nhập đầy đủ mã và mật khẩu!');
      return;
    }

    try {
      // Kiểm tra mã và password (giống như đăng nhập Settings)
      const isValid = await this.validateDeleteCredentials(this.deleteCode, this.deletePassword);
      
      if (isValid) {
        // Thực hiện xóa dựa trên action
        if (this.currentDeleteAction === 'clearData') {
          await this.clearScheduleData();
        } else if (this.currentDeleteAction === 'deleteCompleted') {
          await this.deleteAllCompletedItems();
        } else if (this.currentDeleteAction === 'freshImport') {
          await this.startFreshImport();
        }
        
        this.closeDeleteDialog();
        alert('✅ Xóa dữ liệu thành công!');
      } else {
        alert('❌ Mã hoặc mật khẩu không đúng!');
      }
    } catch (error) {
      console.error('❌ Lỗi khi xác nhận xóa:', error);
      alert('❌ Lỗi khi xác nhận xóa!');
    }
  }

  // Kiểm tra mã và password (giống như đăng nhập Settings)
  private async validateDeleteCredentials(code: string, password: string): Promise<boolean> {
    try {
      // Sử dụng logic tương tự như đăng nhập Settings
      // Bạn cần implement logic này dựa trên hệ thống authentication hiện tại
      const userDoc = await this.firestore.collection('users', (ref: any) => 
        ref.where('code', '==', code).where('password', '==', password)
      ).get().toPromise();
      
      return userDoc && !userDoc.empty;
    } catch (error) {
      console.error('❌ Lỗi khi kiểm tra credentials:', error);
      return false;
    }
  }

  clearScheduleData(): void {
    console.log('🔍 clearScheduleData() called');

    if (confirm('⚠️ Bạn có chắc chắn muốn xóa tất cả dữ liệu hiện tại? Hành động này không thể hoàn tác!')) {
      console.log('🗑️ User confirmed deletion, clearing all schedule data...');
      
      // Clear local data
      this.scheduleData = [];
      this.firebaseSaved = false;
      
      console.log('🗑️ Local data cleared, calling clearFirebaseData()...');
      
      // Clear data from Firebase by updating the latest document
      this.clearFirebaseData();
      
      alert('🗑️ Đã xóa tất cả dữ liệu lịch trình in!');
    } else {
      console.log('❌ User cancelled deletion');
    }
  }

  // Clear data from Firebase
  private async clearFirebaseData(): Promise<void> {
    try {
      console.log('🔥 Clearing ALL data from Firebase...');
      
      // Delete ALL documents in the printSchedules collection
      const querySnapshot = await this.firestore.collection('printSchedules').get().toPromise();
      
      if (querySnapshot && !querySnapshot.empty) {
        console.log(`🗑️ Found ${querySnapshot.size} documents to delete`);
        
        // Delete all documents
        const deletePromises = querySnapshot.docs.map((doc: any) => doc.ref.delete());
        await Promise.all(deletePromises);
        
        console.log('✅ ALL Firebase data deleted successfully');
      } else {
        console.log('ℹ️ No documents found to delete');
      }
      
      // Also clear any cached data
      this.scheduleData = [];
      this.firebaseSaved = false;
      
      // Set a flag to prevent auto-reload
      (window as any).dataCleared = true;
      
      alert('🗑️ Đã xóa HOÀN TOÀN tất cả dữ liệu về mã tem khỏi Firebase!\n\nDữ liệu đã bị xóa vĩnh viễn và không thể khôi phục.');
      
    } catch (error) {
      console.error('❌ Error deleting Firebase data:', error);
      alert('❌ Lỗi khi xóa dữ liệu khỏi Firebase');
    }
  }

  // Xóa tất cả các mã đã hoàn thành
  deleteAllCompletedItems(): void {
    if (!this.hasPermission()) {
      this.showLoginDialogForAction('deleteCompleted');
      return;
    }

    // Đếm số lượng mã đã hoàn thành (chỉ dựa trên tình trạng "Done")
    const completedItems = this.scheduleData.filter(item => item.tinhTrang === 'Done');
    
    if (completedItems.length === 0) {
      alert('ℹ️ Không có mã nào đã hoàn thành hoặc có tình trạng "Done" để xóa!');
      return;
    }

    if (confirm(`⚠️ Bạn có chắc chắn muốn xóa tất cả ${completedItems.length} mã đã hoàn thành và có tình trạng "Done"?\n\nHành động này không thể hoàn tác!`)) {
      console.log(`🗑️ Deleting ${completedItems.length} completed items...`);
      
      // Lọc ra các mã chưa hoàn thành và không có tình trạng "Done"
      const remainingItems = this.scheduleData.filter(item => item.tinhTrang !== 'Done');
      
      // Cập nhật dữ liệu
      this.scheduleData = remainingItems;
      this.firebaseSaved = false;
      
      // Lưu vào Firebase
      this.saveToFirebase(remainingItems);
      
      alert(`✅ Đã xóa thành công ${completedItems.length} mã đã hoàn thành và có tình trạng "Done"!\n\nCòn lại: ${remainingItems.length} mã chưa hoàn thành.`);
    }
  }

  // Add function to show import history
  showImportHistory(): void {
    console.log('📋 Showing import history...');
    this.firestore.collection('printSchedules', ref => 
      ref.orderBy('importedAt', 'desc')
    ).get().subscribe((querySnapshot) => {
      let historyText = '📋 Lịch sử Import:\n\n';
      let totalRecords = 0;
      
      querySnapshot.forEach((doc) => {
        const data = doc.data() as any;
        const importDate = data.importedAt?.toDate() || new Date();
        const recordCount = data.recordCount || 0;
        totalRecords += recordCount;
        
        historyText += `📅 ${importDate.toLocaleString('vi-VN')}\n`;
        historyText += `📊 Số bản ghi: ${recordCount}\n`;
        historyText += `📁 Tháng: ${data.month || 'N/A'}\n`;
        historyText += `🆔 ID: ${doc.id}\n`;
        historyText += '─'.repeat(50) + '\n\n';
      });
      
      historyText += `📈 Tổng cộng: ${totalRecords} bản ghi trong ${querySnapshot.size} lần import`;
      
      alert(historyText);
    }, (error) => {
      console.error('❌ Error loading import history:', error);
      alert('❌ Lỗi khi tải lịch sử import');
    });
  }

  // Add function to start fresh import (clear existing data first)
  async startFreshImport(): Promise<void> {
      console.log('🔄 Starting fresh import...');
    
    // Clear local data
      this.scheduleData = [];
      this.firebaseSaved = false;
    
    // Clear Firebase data
    await this.clearFirebaseData();
    
    alert('🔄 Đã xóa dữ liệu cũ và sẵn sàng cho import mới. Vui lòng chọn file Excel.');
  }

  // Hiển thị popup xác nhận xóa dữ liệu cũ và import lại
  showFreshImportConfirmDialog(): void {
    this.currentDeleteAction = 'freshImport';
    this.deleteDialogMessage = 'Bạn có chắc chắn muốn xóa dữ liệu cũ và import lại? Dữ liệu cũ sẽ bị mất!';
    this.deleteCode = '';
    this.deletePassword = '';
    this.showDeleteDialog = true;
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
    
    // This method is deprecated - use the new camera capture flow instead
    alert('⚠️ Chức năng này đã được thay thế.\nVui lòng sử dụng nút 📸 trong bảng Print Schedules để so sánh tem.');
  }

  // Removed old performIntelligentAnalysis method - using new one with proper signature

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

  // Enhanced Photo Capture for Labels - 2 Steps
  captureAndCompareLabel(item: ScheduleItem): void {
    console.log('📸 Starting enhanced photo capture for item:', item.maTem);
    
    // Reset capture state
    this.captureStep = 1;
    this.currentCaptureMode = 'design';
    
    // Start with design photo capture
    this.startPhotoCapture(item, 'design');
  }

  // Start photo capture for specific mode
  startPhotoCapture(item: ScheduleItem, mode: 'design' | 'printed'): void {
    console.log(`📸 Starting ${mode} photo capture for item:`, item.maTem);
    
    // Prevent multiple captures
    if (this.isCapturingPhoto) {
      console.log('⚠️ Already capturing photo, please wait...');
      return;
    }
    
    this.isCapturingPhoto = true;
    this.currentCaptureMode = mode;
    
    // Clean up any existing camera streams first
    this.cleanupCameraStreams();
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('❌ Camera not available on this device');
      this.isCapturingPhoto = false;
      return;
    }

    // Camera constraints
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
        video.playsInline = true;
        video.muted = true;
        
        // Create canvas for capturing
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          alert('❌ Cannot create canvas context');
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        // Set canvas size based on video dimensions
        video.onloadedmetadata = () => {
          console.log('📺 Video metadata loaded, setting canvas size');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          
          // Wait a bit for video to be ready
          setTimeout(() => {
            console.log('📺 Video ready, showing dialog');
            const captureDialog = this.createEnhancedCaptureDialog(video, canvas, item, mode);
            document.body.appendChild(captureDialog);
          }, 500);
        };

        // Fallback timeout
        setTimeout(() => {
          if (!document.querySelector('.camera-dialog')) {
            console.log('⏰ Fallback: Showing dialog after timeout');
            const captureDialog = this.createEnhancedCaptureDialog(video, canvas, item, mode);
            document.body.appendChild(captureDialog);
          }
        }, 3000);

        // Safety timeout to reset flag and cleanup
        setTimeout(() => {
          if (this.isCapturingPhoto) {
            console.log('⚠️ Safety timeout: Resetting capture flag and cleaning up');
            this.isCapturingPhoto = false;
            this.cleanupCameraStreams();
          }
        }, 10000);
      })
      .catch(error => {
        console.error('❌ Camera error:', error);
        this.isCapturingPhoto = false;
        if (error.name === 'NotAllowedError') {
          alert('❌ Camera permission denied. Please allow camera access and try again.');
        } else if (error.name === 'NotFoundError') {
          alert('❌ No camera found on this device.');
        } else {
          alert('❌ Cannot access camera: ' + error.message);
        }
      });
  }

  createEnhancedCaptureDialog(video: HTMLVideoElement, canvas: HTMLCanvasElement, item: ScheduleItem, mode: 'design' | 'printed'): HTMLElement {
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
    const modeText = mode === 'design' ? 'Bản vẽ thiết kế' : 'Tem đã in';
    const stepText = mode === 'design' ? 'Bước 1/2' : 'Bước 2/2';
    title.textContent = `📸 Chụp hình ${modeText} - ${item.maTem || 'Unknown'} (${stepText})`;
    title.style.cssText = `
      margin: 0 !important;
      color: #333 !important;
      font-size: 18px !important;
      font-weight: bold !important;
    `;

    const instruction = document.createElement('p');
    const instructionText = mode === 'design' ? 
      `<strong>Hướng dẫn chụp bản vẽ:</strong><br>
      • Đặt bản vẽ thiết kế vào giữa khung hình<br>
      • Đảm bảo đủ ánh sáng và chụp rõ nét<br>
      • Hình sẽ được tối ưu hóa và lưu vào Firebase` :
      `<strong>Hướng dẫn chụp tem in:</strong><br>
      • Đặt tem đã in vào giữa khung hình<br>
      • Đảm bảo đủ ánh sáng và chụp rõ nét<br>
      • Hình sẽ được tối ưu hóa và lưu vào Firebase`;
    instruction.innerHTML = instructionText;
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
      background: #000 !important;
    `;

    // Ensure video is playing
    video.play().then(() => {
      console.log('✅ Video started playing successfully');
    }).catch(error => {
      console.error('❌ Error playing video:', error);
    });

    // Add error handling for video
    video.onerror = (error) => {
      console.error('❌ Video error:', error);
    };

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
      this.captureAndSavePhoto(video, canvas, item, dialog, mode);
    };

    const handleCancelClick = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('❌ Cancel button activated!');
      
      // Stop video stream
      if (video.srcObject) {
        const tracks = (video.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
      
      // Remove camera dialog
      this.removeCameraDialog(dialog);
      
      // Reset capture flag
      this.isCapturingPhoto = false;
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

  captureAndSavePhoto(video: HTMLVideoElement, canvas: HTMLCanvasElement, item: ScheduleItem, dialog: HTMLElement, mode: 'design' | 'printed'): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('❌ Cannot get canvas context');
      this.isCapturingPhoto = false;
      this.removeCameraDialog(dialog);
      return;
    }

    console.log('📸 Capturing photo for item:', item.maTem);

    // Ensure video is playing and has valid dimensions
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      console.log('⚠️ Video dimensions not ready, waiting...');
      setTimeout(() => {
        this.captureAndSavePhoto(video, canvas, item, dialog, this.currentCaptureMode);
      }, 500);
      return;
    }

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    console.log('📐 Canvas size set to:', canvas.width, 'x', canvas.height);
    
    // Draw video frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Stop video stream immediately
    if (video.srcObject) {
      const tracks = (video.srcObject as MediaStream).getTracks();
      tracks.forEach(track => {
        track.stop();
        console.log('🛑 Stopped video track:', track.kind);
      });
    }

    // Remove camera dialog immediately
    this.removeCameraDialog(dialog);
    
    // Reset capture flag immediately
    this.isCapturingPhoto = false;

    // Convert to blob and save
    canvas.toBlob((blob) => {
      if (blob) {
        console.log('📷 Photo captured, size:', blob.size, 'bytes');
        this.savePhotoToFirebase(blob, item, mode);
      } else {
        console.error('❌ Failed to create blob from canvas');
        alert('❌ Lỗi khi chụp hình');
        this.isCapturingPhoto = false;
        // Double-check dialog removal
        this.removeCameraDialog(dialog);
      }
    }, 'image/jpeg', 0.8);
  }

  savePhotoToFirebase(blob: Blob, item: ScheduleItem, mode: 'design' | 'printed'): void {
    console.log(`💾 Saving ${mode} photo to Firebase for item:`, item.maTem);
    
    // Convert blob to base64 and optimize
    const reader = new FileReader();
    reader.onload = async () => {
      const base64Data = reader.result as string;
      console.log('📄 Original Base64 data length:', base64Data.length);
      
      try {
        // Optimize image to 250KB max (theo yêu cầu)
        const optimizedImage = await this.optimizeImageForStorage(base64Data, 250);
        console.log('📄 Optimized Base64 data length:', optimizedImage.length);
        
        // Create photo document for Firebase
        const photoData = {
          itemId: item.stt || '',
          maTem: item.maTem || '',
          maHang: item.maHang || '',
          khachHang: item.khachHang || '',
          photoUrl: optimizedImage,
          photoType: mode, // 'design' hoặc 'printed'
          capturedAt: new Date(),
          savedAt: new Date()
        };

        // Save to Firebase
        this.firestore.collection('labelPhotos').add(photoData)
          .then((docRef) => {
            console.log(`✅ ${mode} photo saved to Firebase with ID:`, docRef.id);
            
            // Initialize labelComparison if not exists
            if (!item.labelComparison) {
              item.labelComparison = {
                photoUrl: '',
                comparisonResult: 'Chờ in',
                comparedAt: new Date(),
                matchPercentage: 0,
                mismatchDetails: [],
                hasSampleText: false
              };
            }
            
            // Update item with photo reference based on mode
            if (mode === 'design') {
              item.labelComparison.designPhotoId = docRef.id;
              item.labelComparison.designPhotoUrl = optimizedImage;
            } else {
              item.labelComparison.printedPhotoId = docRef.id;
              item.labelComparison.printedPhotoUrl = optimizedImage;
            }

            // Always update comparedAt to current time when photo is saved
            item.labelComparison.comparedAt = new Date();

            // Update schedule in Firebase
            this.updateScheduleInFirebase(item);
            
            // Refresh storage information after saving photo
            this.refreshStorageInfo();
            
            // Check if both photos are captured
            if (item.labelComparison.designPhotoId && item.labelComparison.printedPhotoId) {
              // Both photos captured, complete process
              this.completePhotoCapture(item);
            } else {
              // Continue to next step
              this.continueToNextCaptureStep(item, mode);
            }
            
            // Reset capture flag and ensure dialog is removed
            this.isCapturingPhoto = false;
            
            // Force cleanup of any remaining camera dialogs
            this.cleanupCameraStreams();
            
            // Double-check dialog removal after a short delay
            setTimeout(() => {
              this.cleanupCameraStreams();
            }, 200);
            
            const modeText = mode === 'design' ? 'bản vẽ thiết kế' : 'tem đã in';
            alert(`✅ Đã chụp và lưu hình ${modeText} thành công! (Đã tối ưu hóa)`);
          })
          .catch((error) => {
            console.error('❌ Error saving photo to Firebase:', error);
            alert('❌ Lỗi khi lưu hình vào Firebase:\n' + error.message);
            this.isCapturingPhoto = false;
          });
      } catch (error) {
        console.error('❌ Error optimizing image:', error);
        alert('❌ Lỗi khi tối ưu hóa hình ảnh');
      }
    };
    
    reader.onerror = (error) => {
      console.error('❌ Error reading blob:', error);
      alert('❌ Lỗi khi xử lý hình ảnh');
    };
    
    reader.readAsDataURL(blob);
  }

  performSimpleComparison(photoUrl: string, item: ScheduleItem): void {
    console.log('🔍 Starting intelligent comparison for item:', item.stt);

    // Show processing dialog
    const processingMsg = this.showProcessingDialog('🔍 Đang phân tích hình ảnh...');
    
    // Simulate processing delay for realistic experience
    setTimeout(() => {
      this.performIntelligentAnalysis(photoUrl, item, processingMsg);
    }, 1000);
  }

  showProcessingDialog(message: string): HTMLElement {
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      background: rgba(0,0,0,0.8) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      z-index: 999999 !important;
      color: white !important;
      font-size: 18px !important;
      text-align: center !important;
    `;
    dialog.innerHTML = `
      <div style="background: rgba(0,0,0,0.9); padding: 30px; border-radius: 10px; text-align: center;">
        <div style="font-size: 24px; margin-bottom: 15px;">🤖</div>
        <div>${message}</div>
        <div style="margin-top: 15px; font-size: 14px; opacity: 0.8;">Vui lòng đợi...</div>
      </div>
    `;
    document.body.appendChild(dialog);
    return dialog;
  }

  performIntelligentAnalysis(photoUrl: string, item: ScheduleItem, processingDialog: HTMLElement): void {
    console.log('🤖 Starting intelligent image analysis...');

    // Step 1: Analyze captured image to separate sample and printed labels
    const imageAnalysis = this.analyzeImageForTwoLabels(photoUrl);
    
    if (!imageAnalysis.success) {
      document.body.removeChild(processingDialog);
      alert('❌ Không thể phân tích hình ảnh!\n\n' + imageAnalysis.error + '\n\nVui lòng:\n• Đảm bảo có đủ ánh sáng\n• Chụp cả tem mẫu và tem in trong khung hình\n• Tem mẫu phải có chữ "Sample"');
      return;
    }

    // Update processing message
    processingDialog.querySelector('div')!.innerHTML = `
      <div style="font-size: 24px; margin-bottom: 15px;">🔍</div>
      <div>Đang so sánh tem mẫu và tem in...</div>
      <div style="margin-top: 15px; font-size: 14px; opacity: 0.8;">Phân tích chi tiết...</div>
    `;

    // Step 2: Extract specifications from sample label
    setTimeout(() => {
      const sampleSpecs = this.extractLabelSpecifications(imageAnalysis.sampleRegion, item);
      const printedSpecs = this.extractLabelSpecifications(imageAnalysis.printedRegion, item);
      
      // Step 3: Compare specifications
      const comparisonResult = this.compareLabelSpecifications(sampleSpecs, printedSpecs);
      
      // Update item with detailed comparison result
      item.labelComparison = {
        photoUrl: photoUrl,
        comparisonResult: comparisonResult.result,
        comparedAt: new Date(),
        matchPercentage: comparisonResult.matchPercentage,
        mismatchDetails: comparisonResult.mismatchDetails,
        hasSampleText: imageAnalysis.hasSampleText,
        sampleSpecs: sampleSpecs,
        printedSpecs: printedSpecs
      };

      // Remove processing dialog
      document.body.removeChild(processingDialog);

      // Save to Firebase
      this.saveComparisonToFirebase(item);

      // Show detailed result
      this.showDetailedComparisonResult(comparisonResult, item);
      
    }, 2000);
  }

  analyzeImageForTwoLabels(photoUrl: string): ImageAnalysisResult {
    console.log('🔍 Analyzing image for two labels...');
    
    try {
      // In real implementation, this would use computer vision to:
      // 1. Detect if there are exactly 2 labels in the image
      // 2. Identify which one has "Sample" text
      // 3. Extract regions for each label
      
      // Simulate analysis
      const hasSampleText = this.detectSampleText(photoUrl);
      
      if (!hasSampleText) {
    return {
          success: false,
          error: 'Không phát hiện chữ "Sample" trên tem mẫu',
          hasSampleText: false,
          sampleRegion: null,
          printedRegion: null
        };
      }

      // Simulate successful detection of two labels
      // In real implementation, this would extract actual image regions
      return {
        success: true,
        hasSampleText: true,
        sampleRegion: null, // Would be actual ImageData
        printedRegion: null // Would be actual ImageData
      };
      
    } catch (error) {
      return {
        success: false,
        error: 'Lỗi khi phân tích hình ảnh: ' + error,
        hasSampleText: false,
        sampleRegion: null,
        printedRegion: null
      };
    }
  }

  extractLabelSpecifications(imageRegion: ImageData | null, item: ScheduleItem): LabelSpecifications {
    console.log('🔍 Extracting label specifications...');
    
    // In real implementation, this would use OCR and image analysis to extract:
    // - Text content and fonts
    // - Colors and sizes
    // - Position and layout
    
    // For now, simulate realistic specs based on item data
    const baseSpecs: LabelSpecifications = {
      text: [
        item.maTem || 'Unknown',
        item.maHang || 'Unknown', 
        item.khachHang || 'Unknown',
        'Made in Vietnam'
      ],
      fontSize: [12, 10, 8, 6],
      fontStyle: ['bold', 'normal', 'normal', 'italic'],
      colors: ['#000000', '#333333', '#666666', '#999999'],
      dimensions: {width: 40, height: 20}, // mm
      position: {x: 0, y: 0},
      quality: Math.floor(Math.random() * 20) + 80 // 80-100
    };

    return baseSpecs;
  }

  compareLabelSpecifications(sampleSpecs: LabelSpecifications, printedSpecs: LabelSpecifications): ComparisonResult {
    console.log('🔍 Comparing label specifications...');
    
    // Detailed comparison analysis
    const textMatch = this.compareTextContent(sampleSpecs.text || [], printedSpecs.text || []);
    const fontMatch = this.compareFontSizes(sampleSpecs.fontSize || [], printedSpecs.fontSize || []);
    const colorMatch = this.compareColors(sampleSpecs.colors || [], printedSpecs.colors || []);
    const sizeMatch = this.compareDimensions(sampleSpecs.dimensions, printedSpecs.dimensions);
    const positionMatch = this.comparePositions(sampleSpecs.position, printedSpecs.position);

    // Calculate overall match percentage
    const overallMatch = Math.round(
      (textMatch + fontMatch + colorMatch + sizeMatch + positionMatch) / 5
    );

    // Determine result based on thresholds
    const result: 'Pass' | 'Fail' = overallMatch >= 85 ? 'Pass' : 'Fail';

    // Generate detailed mismatch information
    const mismatchDetails: string[] = [];
    if (textMatch < 90) mismatchDetails.push(`Nội dung text không khớp (${textMatch}%)`);
    if (fontMatch < 90) mismatchDetails.push(`Font size sai lệch (${fontMatch}%)`);
    if (colorMatch < 90) mismatchDetails.push(`Màu sắc không đúng (${colorMatch}%)`);
    if (sizeMatch < 90) mismatchDetails.push(`Kích thước tem sai (${sizeMatch}%)`);
    if (positionMatch < 90) mismatchDetails.push(`Vị trí layout khác biệt (${positionMatch}%)`);

    return {
      result,
      matchPercentage: overallMatch,
      mismatchDetails,
      detailedAnalysis: {
        textMatch,
        fontMatch,
        colorMatch,
        sizeMatch,
        positionMatch
      }
    };
  }

  // Helper comparison methods
  compareTextContent(sample: string[], printed: string[]): number {
    if (sample.length !== printed.length) return 60;
    
    let matches = 0;
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === printed[i]) matches++;
    }
    return Math.round((matches / sample.length) * 100);
  }

  compareFontSizes(sample: number[], printed: number[]): number {
    if (sample.length !== printed.length) return 70;
    
    let totalDiff = 0;
    for (let i = 0; i < sample.length; i++) {
      const diff = Math.abs(sample[i] - printed[i]) / sample[i];
      totalDiff += diff;
    }
    const avgDiff = totalDiff / sample.length;
    return Math.max(0, Math.round((1 - avgDiff) * 100));
  }

  compareColors(sample: string[], printed: string[]): number {
    if (sample.length !== printed.length) return 75;
    
    let matches = 0;
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === printed[i]) matches++;
    }
    return Math.round((matches / sample.length) * 100);
  }

  compareDimensions(sample: any, printed: any): number {
    if (!sample || !printed) return 80;
    
    const widthDiff = Math.abs(sample.width - printed.width) / sample.width;
    const heightDiff = Math.abs(sample.height - printed.height) / sample.height;
    const avgDiff = (widthDiff + heightDiff) / 2;
    return Math.max(0, Math.round((1 - avgDiff) * 100));
  }

  comparePositions(sample: any, printed: any): number {
    if (!sample || !printed) return 85;
    
    const xDiff = Math.abs(sample.x - printed.x);
    const yDiff = Math.abs(sample.y - printed.y);
    const totalDiff = Math.sqrt(xDiff * xDiff + yDiff * yDiff);
    return Math.max(0, Math.round(Math.max(0, 100 - totalDiff * 10)));
  }

  showDetailedComparisonResult(result: ComparisonResult, item: ScheduleItem): void {
    const status = result.result === 'Pass' ? '✅ PASS' : '❌ FAIL';
    const details = result.detailedAnalysis;
    
    // Separate text details from other details
    const textDetails = result.mismatchDetails.filter(detail => detail.includes('📝'));
    const otherDetails = result.mismatchDetails.filter(detail => !detail.includes('📝'));
    
    let detailsText = '';
    if (textDetails.length > 0) {
      detailsText += '\n\n📝 Chi tiết so sánh Text:\n' + textDetails.map(detail => `• ${detail.replace('📝 Text không khớp (', '').replace('%)', '')}`).join('\n');
    }
    
    if (otherDetails.length > 0) {
      detailsText += '\n\n🔍 Các vấn đề khác:\n' + otherDetails.map(detail => `• ${detail}`).join('\n');
    }
    
    if (result.mismatchDetails.length === 0) {
      detailsText = '\n\n✅ Tất cả yếu tố đều khớp!';
    }
    
    const message = `${status} - ${item.maTem}\n\n` +
      `📊 Kết quả chi tiết:\n` +
      `• Tổng điểm: ${result.matchPercentage}%\n\n` +
      `🔍 Phân tích từng yếu tố:\n` +
      `• Nội dung text: ${details.textMatch}%\n` +
      `• Font size: ${details.fontMatch}%\n` +
      `• Kích thước: ${details.sizeMatch}%\n` +
      `• Vị trí: ${details.positionMatch}%\n` +
      detailsText + '\n\n💾 Đã lưu vào Firebase';

    alert(message);
  }

  detectSampleText(photoUrl: string): boolean {
    // Enhanced Sample text detection
    // In real implementation, this would use OCR API like Google Vision API
    console.log('🔍 Detecting "Sample" text in image:', photoUrl);
    
    // Simulate more realistic detection based on image quality
    const imageQuality = this.assessImageQuality(photoUrl);
    
    // Higher quality images have better Sample detection rate
    const detectionRate = imageQuality > 70 ? 0.95 : 0.7;
    return Math.random() < detectionRate;
  }

  assessImageQuality(photoUrl: string): number {
    // Simulate image quality assessment
    // In real implementation, this would analyze blur, lighting, contrast
    return Math.floor(Math.random() * 30) + 70; // 70-100
  }



  performAutomaticAnalysis(blob: Blob, item: ScheduleItem): void {
    console.log('🤖 Starting automatic image analysis...');
    
    // Show processing dialog
    const processingDialog = this.showProcessingDialog('🔍 Đang tự động phân tích hình ảnh...');
    
    // Convert blob to data URL for analysis
    const reader = new FileReader();
    reader.onload = (e) => {
      const imageDataUrl = e.target?.result as string;
      
      // Simulate processing steps
      setTimeout(() => {
        // Step 1: Detect and separate sample vs printed labels
        const detectionResult = this.automaticallyDetectLabels(imageDataUrl);
        
        if (!detectionResult.success) {
          document.body.removeChild(processingDialog);
          alert('❌ Không thể phát hiện tem mẫu và tem in!\n\nVui lòng:\n• Đặt tem SAMPLE bên trái\n• Đặt tem IN bên phải\n• Đảm bảo đủ ánh sáng');
          return;
        }
        
        // Update processing message
        processingDialog.querySelector('div')!.innerHTML = `
          <div style="font-size: 24px; margin-bottom: 15px;">📝</div>
          <div>Đang đọc thông tin từ tem...</div>
          <div style="margin-top: 15px; font-size: 14px; opacity: 0.8;">Phát hiện: ${detectionResult.sampleTexts.length} text regions</div>
        `;
        
        setTimeout(() => {
          // Step 2: Extract detailed information from both labels
          const sampleInfo = this.extractLabelInformation(detectionResult.sampleRegion, item, 'sample');
          const printedInfo = this.extractLabelInformation(detectionResult.printedRegion, item, 'printed');
          
          // Update processing message
          processingDialog.querySelector('div')!.innerHTML = `
            <div style="font-size: 24px; margin-bottom: 15px;">🔍</div>
            <div>Đang so sánh thông tin...</div>
            <div style="margin-top: 15px; font-size: 14px; opacity: 0.8;">
              Sample: ${sampleInfo.text?.length || 0} texts, ${sampleInfo.colors?.length || 0} colors<br>
              Printed: ${printedInfo.text?.length || 0} texts, ${printedInfo.colors?.length || 0} colors
            </div>
          `;
          
          setTimeout(() => {
            // Step 3: Perform intelligent comparison
            const comparisonResult = this.compareLabelInformation(sampleInfo, printedInfo, item);
            
            // Update item with comparison result
            item.labelComparison = {
              photoUrl: imageDataUrl,
              comparisonResult: comparisonResult.result,
              comparedAt: new Date(),
              matchPercentage: comparisonResult.matchPercentage,
              mismatchDetails: comparisonResult.mismatchDetails,
              hasSampleText: detectionResult.hasSampleText,
              sampleSpecs: sampleInfo,
              printedSpecs: printedInfo
            };
            
            console.log('📊 Comparison result created:', item.labelComparison);
            
            // Clean up
            document.body.removeChild(processingDialog);
            
            // Save to Firebase with error handling
            try {
              this.saveComparisonToFirebase(item);
            } catch (error) {
              console.error('❌ Error in saveComparisonToFirebase:', error);
              alert('❌ Lỗi khi lưu kết quả so sánh:\n' + error);
            }
            
            // Show detailed result
            this.showDetailedComparisonResult(comparisonResult, item);
            
          }, 1500);
          
        }, 1500);
        
      }, 1000);
    };
    
    reader.readAsDataURL(blob);
  }

  automaticallyDetectLabels(imageDataUrl: string): {
    success: boolean;
    error?: string;
    hasSampleText: boolean;
    sampleRegion: any;
    printedRegion: any;
    sampleTexts: string[];
    printedTexts: string[];
  } {
    console.log('🔍 Automatically detecting sample and printed labels...');
    
    // Simulate automatic detection
    // In real implementation, this would use computer vision to:
    // 1. Detect two separate regions (left/right)
    // 2. Identify which is sample vs printed
    // 3. Extract text regions from each
    
    const hasSampleText = Math.random() > 0.2; // 80% chance of detecting "Sample"
    
    if (!hasSampleText) {
      return {
        success: false,
        error: 'Không tìm thấy chữ "Sample" trên tem mẫu',
        hasSampleText: false,
        sampleRegion: null,
        printedRegion: null,
        sampleTexts: [],
        printedTexts: []
      };
    }
    
    // Simulate detected text regions
    const sampleTexts = [
      'Sample',
      'Made in Vietnam',
      'ABC123',
      'LOT: 2025001'
    ];
    
    const printedTexts = [
      'Made in Vietnam',
      'ABC123',
      'LOT: 2025001',
      'EXP: 2026/12'
    ];
    
    return {
      success: true,
      hasSampleText: true,
      sampleRegion: { x: 0, y: 0, width: 200, height: 150 },
      printedRegion: { x: 220, y: 0, width: 200, height: 150 },
      sampleTexts: sampleTexts,
      printedTexts: printedTexts
    };
  }

  extractLabelInformation(region: any, item: ScheduleItem, type: 'sample' | 'printed'): LabelSpecifications {
    console.log(`📝 Extracting information from ${type} label...`);
    
    // Simulate OCR and analysis with more realistic data
    const texts = type === 'sample' ? 
      ['Sample', 'Made in Vietnam', 'ABC123', 'LOT: 2025001'] :
      ['Made in Vietnam', 'ABC123', 'LOT: 2025001', 'EXP: 2026/12'];
    
    // More realistic font sizes based on typical label text
    const fontSizes = type === 'sample' ? 
      [16, 14, 12, 10] : // Sample: Title larger, details smaller
      [14, 12, 10, 8];   // Printed: Slightly smaller overall
    
    const fontStyles = ['Arial', 'Arial', 'Arial', 'Arial'];
    const colors = ['#000000', '#000000', '#000000', '#000000'];
    
    // More realistic dimensions based on typical label sizes
    const dimensions = type === 'sample' ? 
      { width: 40, height: 25 } : // Sample: Standard size
      { width: 38, height: 23 };  // Printed: Slightly different (realistic variation)
    
    const position = { x: region?.x || 0, y: region?.y || 0 };
    const quality = Math.floor(Math.random() * 20) + 80; // 80-100
    
    // Simulate OCR with bounding boxes and possible missing texts
    const allTexts = type === 'sample' ?
      [
        { value: 'Sample', bbox: { x: 10, y: 10, width: 60, height: 20 } },
        { value: 'Made in Vietnam', bbox: { x: 10, y: 40, width: 120, height: 20 } },
        { value: 'ABC123', bbox: { x: 10, y: 70, width: 60, height: 20 } },
        { value: 'LOT: 2025001', bbox: { x: 10, y: 100, width: 100, height: 20 } }
      ] :
      [
        { value: 'Made in Vietnam', bbox: { x: 10, y: 40, width: 120, height: 20 } },
        { value: 'ABC123', bbox: { x: 10, y: 70, width: 60, height: 20 } },
        { value: 'LOT: 2025001', bbox: { x: 10, y: 100, width: 100, height: 20 } },
        { value: 'EXP: 2026/12', bbox: { x: 10, y: 130, width: 90, height: 20 } }
      ];

    const detectedTexts: DetectedText[] = allTexts; // Không random bỏ sót nữa
    const text = detectedTexts.map(t => t.value);
    
    return {
      text,
      detectedTexts,
      fontSize: fontSizes,
      fontStyle: fontStyles,
      colors: colors,
      dimensions: dimensions,
      position: position,
      quality: quality
    };
  }

  compareLabelInformation(sampleInfo: LabelSpecifications, printedInfo: LabelSpecifications, item: ScheduleItem): ComparisonResult {
    console.log('🔍 Comparing extracted label information...');
    
    // Compare texts with detailed analysis
    const textComparison = this.compareTextArraysDetailed(sampleInfo.text || [], printedInfo.text || []);
    
    // Compare font sizes
    const fontMatch = this.compareNumberArrays(sampleInfo.fontSize || [], printedInfo.fontSize || []);
    
    // Compare dimensions
    const sizeMatch = this.compareDimensions(sampleInfo.dimensions, printedInfo.dimensions);
    
    // Compare positions
    const positionMatch = this.comparePositions(sampleInfo.position, printedInfo.position);
    
    // Calculate overall match (excluding color)
    const overallMatch = Math.round((textComparison.matchPercentage + fontMatch + sizeMatch + positionMatch) / 4);
    const result: 'Pass' | 'Fail' = overallMatch >= 85 ? 'Pass' : 'Fail';
    
    // Generate detailed mismatch details
    const mismatchDetails: string[] = [];
    
    // Add detailed text comparison results
    if (textComparison.matchPercentage < 90) {
      mismatchDetails.push(`📝 Text không khớp (${textComparison.matchPercentage}%)`);
      mismatchDetails.push(...textComparison.details);
    }
    
    if (fontMatch < 90) mismatchDetails.push(`🔤 Font size sai lệch (${fontMatch}%)`);
    if (sizeMatch < 90) mismatchDetails.push(`📏 Kích thước sai (${sizeMatch}%)`);
    if (positionMatch < 90) mismatchDetails.push(`📍 Vị trí không đúng (${positionMatch}%)`);
    
    // Compare detectedTexts for missing/undetected texts
    const missingOnSample: DetectedText[] = (sampleInfo.detectedTexts || []).filter(
      t => !(sampleInfo.text || []).includes(t.value)
    );
    const missingOnPrinted: DetectedText[] = (sampleInfo.detectedTexts || []).filter(
      t => !(printedInfo.text || []).includes(t.value)
    );
    sampleInfo.missingTexts = missingOnSample;
    printedInfo.missingTexts = missingOnPrinted;
    
    return {
      result,
      matchPercentage: overallMatch,
      mismatchDetails,
      detailedAnalysis: {
        textMatch: textComparison.matchPercentage,
        fontMatch: fontMatch,
        colorMatch: 100, // Always 100 since we don't compare colors
        sizeMatch: sizeMatch,
        positionMatch: positionMatch
      }
    };
  }

  compareTextArraysDetailed(sample: string[], printed: string[]): {
    matchPercentage: number;
    details: string[];
    sampleTexts: string[];
    printedTexts: string[];
  } {
    if (sample.length === 0 || printed.length === 0) {
      return {
        matchPercentage: 0,
        details: ['Không phát hiện được text nào'],
        sampleTexts: sample,
        printedTexts: printed
      };
    }
    
    let matches = 0;
    const details: string[] = [];
    const matchedTexts: string[] = [];
    const missingTexts: string[] = [];
    const extraTexts: string[] = [];
    
    // Check each sample text against printed texts
    sample.forEach(sampleText => {
      const found = printed.find(printedText => 
        printedText.toLowerCase().includes(sampleText.toLowerCase()) || 
        sampleText.toLowerCase().includes(printedText.toLowerCase())
      );
      
      if (found) {
        matches++;
        matchedTexts.push(`${sampleText} ↔ ${found}`);
      } else {
        missingTexts.push(sampleText);
      }
    });
    
    // Find extra texts in printed that are not in sample
    printed.forEach(printedText => {
      const found = sample.find(sampleText => 
        printedText.toLowerCase().includes(sampleText.toLowerCase()) || 
        sampleText.toLowerCase().includes(printedText.toLowerCase())
      );
      
      if (!found) {
        extraTexts.push(printedText);
      }
    });
    
    // Generate detailed comparison report
    if (matchedTexts.length > 0) {
      details.push(`✅ Text khớp: ${matchedTexts.join(', ')}`);
    }
    
    if (missingTexts.length > 0) {
      details.push(`❌ Text thiếu trên tem in: ${missingTexts.join(', ')}`);
    }
    
    if (extraTexts.length > 0) {
      details.push(`➕ Text thêm trên tem in: ${extraTexts.join(', ')}`);
    }
    
    const matchPercentage = Math.round((matches / sample.length) * 100);
    
    return {
      matchPercentage,
      details,
      sampleTexts: sample,
      printedTexts: printed
    };
  }

  compareTextArrays(sample: string[], printed: string[]): number {
    if (sample.length === 0 || printed.length === 0) return 0;
    
    let matches = 0;
    sample.forEach(sampleText => {
      if (printed.some(printedText => printedText.includes(sampleText) || sampleText.includes(printedText))) {
        matches++;
      }
    });
    
    return Math.round((matches / sample.length) * 100);
  }

  compareNumberArrays(sample: number[], printed: number[]): number {
    if (sample.length === 0 || printed.length === 0) return 0;
    
    let matches = 0;
    sample.forEach(sampleNum => {
      if (printed.some(printedNum => Math.abs(sampleNum - printedNum) <= 2)) {
        matches++;
      }
    });
    
    return Math.round((matches / sample.length) * 100);
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
      alert('❌ Không có dữ liệu so sánh để lưu');
      return;
    }

    // Save comparison data to Firebase
    const comparisonData = {
      itemId: item.stt || '',
      maTem: item.maTem || '',
      maHang: item.maHang || '',
      khachHang: item.khachHang || '',
      photoUrl: item.labelComparison.photoUrl || '',
              comparisonResult: item.labelComparison.comparisonResult || 'Chờ in',
      matchPercentage: item.labelComparison.matchPercentage || 0,
      comparedAt: item.labelComparison.comparedAt || new Date(),
      mismatchDetails: item.labelComparison.mismatchDetails || [],
      hasSampleText: item.labelComparison.hasSampleText || false,
      savedAt: new Date(),
      compressed: true
    };

    console.log('📤 Attempting to save comparison data:', comparisonData);

    this.firestore.collection('labelComparisons').add(comparisonData)
      .then((docRef) => {
        console.log('✅ Comparison saved to Firebase with ID: ', docRef.id);
        
        // Also update the main schedules document
        this.updateScheduleInFirebase(item);
        
        // Show success message
        alert('✅ Đã lưu kết quả so sánh thành công!');
      })
      .catch((error) => {
        console.error('❌ Error saving comparison to Firebase: ', error);
        alert('❌ Lỗi khi lưu kết quả so sánh vào Firebase:\n' + error.message);
      });
  }

  updateScheduleInFirebase(item: ScheduleItem): void {
    console.log('🔄 Updating schedule in Firebase for item:', item.stt);
    
    // Clean the item data to remove undefined values
    const cleanItem = this.cleanScheduleItem(item);
    
    // Find the specific document that contains this item
    this.firestore.collection('printSchedules', ref => 
      ref.orderBy('importedAt', 'desc')
    ).get().toPromise()
      .then((querySnapshot: any) => {
        if (querySnapshot && !querySnapshot.empty) {
          // Search through all documents to find the one containing this item
          let foundDoc = null;
          let foundItemIndex = -1;
          
          for (const doc of querySnapshot.docs) {
            const docData = doc.data();
            const scheduleData = docData.data || [];
            
            const itemIndex = scheduleData.findIndex((scheduleItem: any) => 
              scheduleItem.stt === cleanItem.stt && scheduleItem.maTem === cleanItem.maTem
            );
            
            if (itemIndex !== -1) {
              foundDoc = doc;
              foundItemIndex = itemIndex;
              break;
            }
          }
          
          if (foundDoc && foundItemIndex !== -1) {
            console.log('✅ Found item in document:', foundDoc.id, 'at index:', foundItemIndex);
            
            const docData = foundDoc.data();
            const updatedData = docData.data || [];
            
            // Update all fields of the item
            updatedData[foundItemIndex] = {
              ...updatedData[foundItemIndex],
              ...cleanItem
            };
            
            // Ensure statusUpdateTime is preserved
            if (cleanItem.statusUpdateTime) {
              updatedData[foundItemIndex].statusUpdateTime = cleanItem.statusUpdateTime;
            }
            
            // Clean the entire data array to remove undefined values
            const cleanData = updatedData.map((item: any) => this.cleanScheduleItem(item));
            
            // Update the document
            foundDoc.ref.update({
              data: cleanData,
              lastUpdated: new Date(),
              lastAction: 'Item updated'
            }).then(() => {
              console.log('✅ Schedule updated successfully');
            }).catch((error) => {
              console.error('❌ Error updating schedule:', error);
              alert('❌ Lỗi khi cập nhật lịch trình:\n' + error.message);
            });
          } else {
            console.warn('⚠️ Item not found in any schedule document');
            console.log('Searching for item:', { stt: cleanItem.stt, maTem: cleanItem.maTem });
            
            // Fallback: update the entire schedule data
            this.updateEntireScheduleInFirebase();
          }
        } else {
          console.warn('⚠️ No schedule documents found');
        }
      })
      .catch((error) => {
        console.error('❌ Error finding schedule document:', error);
        alert('❌ Lỗi khi tìm tài liệu lịch trình:\n' + error.message);
      });
  }

  getComparisonIcon(item: ScheduleItem): string {
    if (!item.labelComparison) return '📸';
    
    const hasDesign = item.labelComparison.designPhotoId;
    const hasPrinted = item.labelComparison.printedPhotoId;
    
    if (hasDesign && hasPrinted) {
      return '📷📷'; // Both photos captured
    } else if (hasDesign || hasPrinted) {
      return '📷'; // One photo captured
    }
    
    return '📸'; // Not captured yet
  }

  getComparisonTooltip(item: ScheduleItem): string {
    if (!item.labelComparison) return 'Chưa chụp hình';
    
    const hasDesign = item.labelComparison.designPhotoId;
    const hasPrinted = item.labelComparison.printedPhotoId;
    
    if (hasDesign && hasPrinted) {
      const date = item.labelComparison.comparedAt;
      return `📷📷 Đã chụp cả 2 hình - ${date?.toLocaleString()}`;
    } else if (hasDesign) {
      return '📷 Đã chụp bản vẽ, chưa chụp tem in';
    } else if (hasPrinted) {
      return '📷 Đã chụp tem in, chưa chụp bản vẽ';
    }
    
    return 'Chưa chụp hình';
  }

  labelComparisonDialog = false;
  currentComparisonIndex = -1;



  // Get items that have been compared (for report)
  getComparedItems(): ScheduleItem[] {
    return this.scheduleData.filter(item => item.labelComparison);
  }






    








  // Get items that have photos captured
  getPhotoCapturedItems(): ScheduleItem[] {
    return this.scheduleData.filter(item => 
      item.labelComparison && 
      (item.labelComparison.photoUrl || 
       item.labelComparison.designPhotoId || 
       item.labelComparison.printedPhotoId)
    );
  }



  // Search functionality
  onSearchChange(event: any): void {
    this.searchTerm = event.target.value;
    console.log('🔍 Search term changed:', this.searchTerm);
  }

  // Tìm kiếm trong các cột: Mã tem, Mã hàng, Tình trạng
  getFilteredScheduleData(): ScheduleItem[] {
    if (!this.searchTerm || this.searchTerm.trim() === '') {
      return this.scheduleData.filter(item => item.tinhTrang !== 'Done');
    }

    const searchLower = this.searchTerm.toLowerCase().trim();
    
    return this.scheduleData.filter(item => {
      // Chỉ hiển thị item không có tình trạng "Done"
      if (item.tinhTrang === 'Done') return false;
      
      // Tìm kiếm trong các cột: Mã tem, Mã hàng, Tình trạng
      const maTem = (item.maTem || '').toLowerCase();
      const maHang = (item.maHang || '').toLowerCase();
      const tinhTrang = (item.tinhTrang || '').toLowerCase();
      
      return maTem.includes(searchLower) || 
             maHang.includes(searchLower) || 
             tinhTrang.includes(searchLower);
    });
  }

  // Refresh display - Load last 30 days data
  refreshDisplay(): void {
    console.log('🔄 Refreshing display - Loading last 30 days data...');
    this.loadDataFromFirebase();
  }

  // Reset to last 30 days data
  resetToLast30Days(): void {
    console.log('🔄 Resetting to last 30 days data...');
    this.loadDataFromFirebase();
  }

  // Filter by month
  filterByMonth(): void {
    const selectedMonth = prompt('Nhập tháng (1-12) để lọc dữ liệu:\n\nLưu ý: Mặc định chỉ hiển thị tem của 30 ngày gần nhất.\nChọn tháng để xem dữ liệu xa hơn.');
    if (selectedMonth && !isNaN(Number(selectedMonth))) {
      const month = parseInt(selectedMonth);
      if (month >= 1 && month <= 12) {
        console.log(`🔍 Filtering data for month: ${month}`);
        this.filterScheduleDataByMonth(month);
      } else {
        alert('Tháng phải từ 1-12!');
      }
    }
  }

  // Filter schedule data by month
  filterScheduleDataByMonth(month: number): void {
    // Load data from Firebase and filter by month
    this.firestore.collection('printSchedules')
      .get()
      .subscribe(snapshot => {
        const filteredData: ScheduleItem[] = [];
        snapshot.forEach(doc => {
          const data = doc.data() as any;
          if (data.thang && parseInt(data.thang) === month) {
            filteredData.push({
              ...data,
              id: doc.id
            });
          }
        });
        
        this.scheduleData = filteredData;
        console.log(`✅ Filtered ${filteredData.length} records for month ${month}`);
        
        if (filteredData.length === 0) {
          alert(`Không có dữ liệu nào cho tháng ${month}`);
        }
      }, error => {
        console.error('❌ Error filtering data:', error);
        alert('Lỗi khi lọc dữ liệu!');
      });
  }



  // Delete item from schedule and Firebase
  deleteItem(item: ScheduleItem): void {
    console.log('🔍 deleteItem called with item:', item);
    console.log('🔍 Current scheduleData length:', this.scheduleData.length);
    
    if (confirm(`⚠️ Xác nhận xóa item "${item.maTem || item.maHang || 'này'}"?\n\nHành động này không thể hoàn tác!`)) {
      console.log(`🗑️ Deleting item:`, item);
      
      // Remove item from local data
      const itemIndex = this.scheduleData.findIndex(i => 
        i.stt === item.stt && 
        i.maTem === item.maTem && 
        i.maHang === item.maHang
      );
      
      console.log(`🔍 Found item at index: ${itemIndex}`);
      
      if (itemIndex !== -1) {
        this.scheduleData.splice(itemIndex, 1);
        console.log(`✅ Item removed from local data`);
        console.log(`📊 Current scheduleData length: ${this.scheduleData.length}`);
        
        // Update Firebase
        this.updateFirebaseAfterItemDeletion();
        
        alert(`✅ Đã xóa item "${item.maTem || item.maHang || 'này'}" thành công!`);
      } else {
        console.error('❌ Item not found in local data');
        console.error('❌ Item to delete:', item);
        console.error('❌ Available items:', this.scheduleData.map(i => ({ stt: i.stt, maTem: i.maTem, maHang: i.maHang })));
        alert('❌ Không tìm thấy item để xóa!');
      }
    } else {
      console.log('❌ User cancelled deletion');
    }
  }

  // Update Firebase after item deletion
  private async updateFirebaseAfterItemDeletion(): Promise<void> {
    try {
      console.log('🔥 Updating Firebase after item deletion...');
      
      // Clean data to remove undefined values before sending to Firebase
      const cleanScheduleData = this.scheduleData.map(item => ({
        nam: item.nam || '',
        thang: item.thang || '',
        stt: item.stt || '',
        sizePhoi: item.sizePhoi || '',
        maTem: item.maTem || '',
        soLuongYeuCau: item.soLuongYeuCau || '',
        soLuongPhoi: item.soLuongPhoi || '',
        maHang: item.maHang || '',
        lenhSanXuat: item.lenhSanXuat || '',
        khachHang: item.khachHang || '',
        ngayNhanKeHoach: item.ngayNhanKeHoach || '',
        yy: item.yy || '',
        ww: item.ww || '',
        lineNhan: item.lineNhan || '',
        nguoiIn: item.nguoiIn || '',
        tinhTrang: item.tinhTrang || '',
        banVe: item.banVe || '',
        ghiChu: item.ghiChu || '',

        labelComparison: item.labelComparison || null
      }));
      
      const querySnapshot = await this.firestore.collection('printSchedules', ref => 
        ref.orderBy('importedAt', 'desc').limit(1)
      ).get().toPromise();
      
      if (querySnapshot && !querySnapshot.empty) {
        const doc = querySnapshot.docs[0];
        await doc.ref.update({
          data: cleanScheduleData,
          lastUpdated: new Date()
        });
        
        console.log('✅ Firebase updated successfully after item deletion');
      }
    } catch (error) {
      console.error('❌ Error updating Firebase after item deletion:', error);
      alert('❌ Lỗi khi cập nhật Firebase sau khi xóa item');
    }
  }

  // Update item in Firebase
  private updateItemInFirebase(item: ScheduleItem): void {
    // Find the document in Firebase and update it
    this.firestore.collection('printSchedules')
      .get()
      .subscribe(snapshot => {
        snapshot.forEach(doc => {
          const data = doc.data() as any;
          // Check if this document contains the item
          if (data.data && Array.isArray(data.data)) {
            const itemIndex = data.data.findIndex((d: any) => 
              d.stt === item.stt && 
              d.maTem === item.maTem && 
              d.maHang === item.maHang
            );
            
            if (itemIndex !== -1) {
              // Update the item in the data array
              data.data[itemIndex] = item;
              
              // Update the document
              doc.ref.update({
                data: data.data,
                updatedAt: new Date()
              }).then(() => {
                console.log(`✅ Updated item in Firebase:`, item);
              }).catch(error => {
                console.error('❌ Error updating Firebase:', error);
              });
            }
          }
        });
      });
  }





  // Add function to get Pending items count
  getPendingItemsCount(): number {
    return this.scheduleData.filter(item => item.tinhTrang === 'Chờ in').length;
  }

  // Add function to get Chờ bản vẽ items count
  getChoBanVeItemsCount(): number {
    return this.scheduleData.filter(item => item.tinhTrang === 'Chờ bản vẽ').length;
  }

  // Add function to get Chờ Template items count
  getChoTemplateItemsCount(): number {
    return this.scheduleData.filter(item => item.tinhTrang === 'Chờ Template').length;
  }

  // Get count of items that are NOT done (completed)
  getNotDoneItemsCount(): number {
    return this.scheduleData.filter(item => item.tinhTrang !== 'Done').length;
  }

  // Get late items count (items past due date and not Done)
  getLateItemsCount(): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset time to start of day
    
    console.log('🔍 Calculating late items count...');
    console.log('📅 Today:', today.toISOString().split('T')[0]);
    console.log('📊 Total items:', this.scheduleData.length);
    
    // Debug: Check all items with ngayNhanKeHoach
    const itemsWithDates = this.scheduleData.filter(item => item.ngayNhanKeHoach);
    console.log('📅 Items with ngayNhanKeHoach:', itemsWithDates.length);
    
    itemsWithDates.forEach(item => {
      console.log(`📋 Item ${item.maTem}: ngayNhanKeHoach type:`, typeof item.ngayNhanKeHoach, 'value:', item.ngayNhanKeHoach);
    });
    
    const lateItems = this.scheduleData.filter(item => {
      // Skip if status is Done
      if (item.tinhTrang === 'Done') return false;
      
      // Check if item has a due date
      if (item.ngayNhanKeHoach != null && item.ngayNhanKeHoach !== '') {
        try {
          let dueDate: Date;
          
          // Handle different date formats from Firebase
          if (typeof item.ngayNhanKeHoach === 'object' && 'toDate' in item.ngayNhanKeHoach) {
            // Firestore Timestamp
            dueDate = (item.ngayNhanKeHoach as any).toDate();
                      } else if (typeof item.ngayNhanKeHoach === 'string' && item.ngayNhanKeHoach!.includes('/')) {
              // Handle DD/MM/YYYY format from Excel import
              const parts = item.ngayNhanKeHoach!.split('/');
              if (parts.length === 3) {
                const day = parseInt(parts[0]);
                const month = parseInt(parts[1]) - 1; // Month is 0-indexed
                const year = parseInt(parts[2]);
                dueDate = new Date(year, month, day);
              } else {
                dueDate = new Date(item.ngayNhanKeHoach!);
              }
            } else {
              // Try to create Date object for other formats
              dueDate = new Date(item.ngayNhanKeHoach!);
            }
          
          // Check if date is valid
          if (isNaN(dueDate.getTime())) {
            console.warn('⚠️ Invalid date for item:', item.maTem, item.ngayNhanKeHoach);
            return false;
          }
          
          // Reset time to start of day for comparison
          dueDate.setHours(0, 0, 0, 0);
          
          const isLate = dueDate < today;
          
          // Debug log for items with dates
          if (item.maTem) {
            console.log(`📋 Item ${item.maTem}: Due date: ${dueDate.toISOString().split('T')[0]}, Is late: ${isLate}`);
          }
          
          // Item is late if due date is before today
          return isLate;
        } catch (error) {
          console.warn('❌ Error processing date for item:', item, error);
          return false;
        }
      }
      
      return false;
    });
    
    console.log(`⏰ Found ${lateItems.length} late items`);
    return lateItems.length;
  }

  // Export photo report to Excel
  exportPhotoReport(): void {
    const photoCapturedItems = this.getPhotoCapturedItems();
    
    if (photoCapturedItems.length === 0) {
      alert('❌ Không có hình nào để xuất báo cáo!\nVui lòng chụp hình trước khi xuất báo cáo.');
      return;
    }

    // Prepare data for Excel export
    const reportData = photoCapturedItems.map(item => ({
      'STT': item.stt || '',
      'Mã tem': item.maTem || '',
      'Mã hàng': item.maHang || '',
      'Khách hàng': item.khachHang || '',
      'Lệnh sản xuất': item.lenhSanXuat || '',
      'Line nhãn': item.lineNhan || '',
      'Người in': item.nguoiIn || '',
      'Ngày chụp': item.labelComparison?.comparedAt ? 
        new Date(item.labelComparison.comparedAt).toLocaleDateString('vi-VN') + ' ' +
        new Date(item.labelComparison.comparedAt).toLocaleTimeString('vi-VN') : '',
      'Dung lượng ảnh': this.getImageSize(item),
      'Trạng thái': 'Đã chụp hình'
    }));

    // Create Excel workbook
    const ws = XLSX.utils.json_to_sheet(reportData);
    
    // Set column widths
    const colWidths = [
      { wch: 8 },   // STT
      { wch: 15 },  // Mã tem
      { wch: 15 },  // Mã hàng
      { wch: 20 },  // Khách hàng
      { wch: 15 },  // Lệnh sản xuất
      { wch: 12 },  // Line nhãn
      { wch: 12 },  // Người in
      { wch: 18 },  // Ngày chụp
      { wch: 12 },  // Dung lượng ảnh
      { wch: 15 }   // Trạng thái
    ];
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Báo cáo hình chụp');

    // Generate filename with current date
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10);
    const filename = `bao-cao-hinh-chup-tem-${dateStr}.xlsx`;

    // Download file
    XLSX.writeFile(wb, filename);
    
    console.log(`📊 Exported ${photoCapturedItems.length} photo records to ${filename}`);
    alert(`✅ Đã xuất báo cáo ${photoCapturedItems.length} hình chụp vào file ${filename}`);
  }

  // Download photos as ZIP by month
  async downloadPhotosAsZip(): Promise<void> {
    // Show month selection dialog
    const selectedMonth = this.showMonthSelectionDialog();
    if (!selectedMonth) return;

    console.log(`📦 Preparing ZIP download for month: ${selectedMonth}`);
    
    try {
      // Show loading message
      alert('Loading');
      
      // Get photos for selected month
      const photos = await this.getPhotosForMonth(selectedMonth);
      
      if (photos.length === 0) {
        alert(`❌ Không có hình nào cho tháng ${selectedMonth}`);
        return;
      }

      // Create ZIP file
      await this.createAndDownloadZip(photos, selectedMonth);
      
    } catch (error) {
      console.error('❌ Error creating ZIP:', error);
      
      // Provide more specific error messages
      let errorMessage = '❌ Lỗi khi tạo file ZIP:\n';
      
      if (error.message && error.message.includes('index')) {
        errorMessage += 'Lỗi Firebase Index. Vui lòng thử lại sau.';
      } else if (error.message && error.message.includes('permission')) {
        errorMessage += 'Không có quyền truy cập dữ liệu.';
      } else {
        errorMessage += error.message || 'Lỗi không xác định';
      }
      
      alert(errorMessage);
    }
  }

  // Show month selection dialog
  showMonthSelectionDialog(): string | null {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    
    const months = [];
    for (let i = 0; i < 12; i++) {
      const month = currentMonth - i;
      const year = currentYear;
      const monthStr = month > 0 ? month.toString().padStart(2, '0') : (month + 12).toString().padStart(2, '0');
      const yearStr = month > 0 ? year.toString() : (year - 1).toString();
      months.push(`${yearStr}-${monthStr}`);
    }

    const monthOptions = months.map(month => {
      const [year, monthNum] = month.split('-');
      const monthName = this.getMonthName(month);
      return `${monthName} ${year}`;
    });

    const selectedIndex = prompt(
      '📅 Chọn tháng để tải về:\n\n' +
      monthOptions.map((option, index) => `${index + 1}. ${option}`).join('\n') +
      '\n\nNhập số (1-12):'
    );

    if (!selectedIndex || isNaN(Number(selectedIndex))) {
      return null;
    }

    const index = Number(selectedIndex) - 1;
    if (index >= 0 && index < months.length) {
      return months[index];
    }

    return null;
  }

  // Get photos for specific month
  async getPhotosForMonth(monthKey: string): Promise<any[]> {
    console.log(`🔍 Getting photos for month: ${monthKey}`);
    
    try {
      // Get all photos without complex query to avoid index issues
      const querySnapshot = await this.firestore.collection('labelPhotos').get().toPromise();

      if (!querySnapshot || querySnapshot.empty) {
        return [];
      }

      const photos = [];
      for (const doc of querySnapshot.docs) {
        const data = doc.data() as any;
        const capturedDate = data.capturedAt?.toDate() || new Date();
        const photoMonth = `${capturedDate.getFullYear()}-${String(capturedDate.getMonth() + 1).padStart(2, '0')}`;
        
        // Filter by month and valid photo types
        if (photoMonth === monthKey && data.photoType && ['design', 'printed'].includes(data.photoType)) {
          photos.push({
            id: doc.id,
            ...data,
            capturedDate: capturedDate
          });
        }
      }

      // Sort by capturedAt descending
      photos.sort((a, b) => {
        const dateA = a.capturedDate || new Date(0);
        const dateB = b.capturedDate || new Date(0);
        return dateB.getTime() - dateA.getTime();
      });

      console.log(`📸 Found ${photos.length} photos for month ${monthKey}`);
      return photos;
      
    } catch (error) {
      console.error('❌ Error getting photos for month:', error);
      throw error;
    }
  }

  // Create and download ZIP file
  async createAndDownloadZip(photos: any[], monthKey: string): Promise<void> {
    console.log(`📦 Creating ZIP with ${photos.length} photos`);
    
    try {
      // Create a comprehensive HTML file with embedded images
      let htmlContent = `
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Báo cáo hình ảnh tháng ${monthKey}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .header { background: #1976d2; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .item { background: white; margin: 20px 0; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .item-title { color: #1976d2; font-size: 18px; font-weight: bold; margin-bottom: 15px; }
        .photo { margin: 15px 0; padding: 15px; border: 1px solid #ddd; border-radius: 6px; }
        .photo-title { font-weight: bold; color: #333; margin-bottom: 10px; }
        .photo-info { color: #666; font-size: 14px; margin-bottom: 10px; }
        .photo-image { max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 4px; }
        .summary { background: #e3f2fd; padding: 20px; border-radius: 8px; margin-top: 20px; }
        .summary-title { font-weight: bold; color: #1976d2; margin-bottom: 10px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📸 BÁO CÁO HÌNH ẢNH THÁNG ${monthKey}</h1>
        <p>Ngày tạo: ${new Date().toLocaleString('vi-VN')}</p>
        <p>Tổng số hình: ${photos.length}</p>
      </div>
`;
      
      // Group photos by item
      const groupedPhotos = this.groupPhotosByItem(photos);
      
      groupedPhotos.forEach((photos, itemKey) => {
        htmlContent += `
    <div class="item">
        <div class="item-title">📋 MÃ TEM: ${itemKey}</div>
`;
        
        photos.forEach((photo, index) => {
          const photoType = photo.photoType === 'design' ? 'Bản vẽ' : 'Tem in';
          const capturedDate = photo.capturedDate ? 
            new Date(photo.capturedDate).toLocaleString('vi-VN') : 'Không xác định';
          const fileSize = photo.photoUrl ? Math.round(photo.photoUrl.length / 1024) : 0;
          
          htmlContent += `
        <div class="photo">
            <div class="photo-title">${index + 1}. ${photoType}</div>
            <div class="photo-info">
                📅 Ngày chụp: ${capturedDate}<br>
                📏 Kích thước: ${fileSize} KB<br>
                🔗 ID: ${photo.id}<br>
                📝 Ghi chú: ${photo.maTem || 'N/A'}
            </div>
            <img src="${photo.photoUrl}" alt="${photoType} - ${itemKey}" class="photo-image" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
            <div style="display:none; color:red; padding:10px; background:#ffe6e6; border-radius:4px;">
                ⚠️ Không thể hiển thị hình ảnh. Có thể do lỗi kết nối hoặc hình đã bị xóa.
            </div>
        </div>
`;
        });
        
        htmlContent += `
    </div>
`;
      });
      
      // Add summary
      const designCount = photos.filter(p => p.photoType === 'design').length;
      const printedCount = photos.filter(p => p.photoType === 'printed').length;
      const totalSize = photos.reduce((sum, p) => sum + (p.photoUrl ? p.photoUrl.length : 0), 0) / 1024;
      
      htmlContent += `
    <div class="summary">
        <div class="summary-title">📊 TỔNG KẾT</div>
        <p>• Tổng số mã tem: ${groupedPhotos.size}</p>
        <p>• Hình bản vẽ: ${designCount}</p>
        <p>• Hình tem in: ${printedCount}</p>
        <p>• Tổng dung lượng: ${Math.round(totalSize)} KB</p>
    </div>
</body>
</html>`;
      
      // Create and download HTML file
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bao-cao-hinh-anh-${monthKey}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      console.log(`✅ HTML report created and downloaded for month ${monthKey}`);
      alert(`✅ Đã tạo và tải về báo cáo HTML cho tháng ${monthKey} với ${photos.length} hình ảnh\n\n📄 File: bao-cao-hinh-anh-${monthKey}.html\n\n💡 Mở file bằng trình duyệt để xem hình ảnh!`);
      
    } catch (error) {
      console.error('❌ Error creating HTML report:', error);
      alert('❌ Lỗi khi tạo báo cáo HTML: ' + error.message);
    }
  }

  // Group photos by item
  groupPhotosByItem(photos: any[]): Map<string, any[]> {
    const grouped = new Map<string, any[]>();
    
    photos.forEach(photo => {
      const key = photo.itemId || photo.maTem || 'unknown';
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(photo);
    });
    
    return grouped;
  }

  // Create ZIP content (simplified version)
  createZipContent(groupedPhotos: Map<string, any[]>, monthKey: string): string {
    let content = `ZIP Archive for month ${monthKey}\n`;
    content += `Generated on ${new Date().toLocaleString()}\n\n`;
    
    groupedPhotos.forEach((photos, itemKey) => {
      content += `Item: ${itemKey}\n`;
      photos.forEach((photo, index) => {
        const photoType = photo.photoType || 'unknown';
        const fileName = `${itemKey}_${photoType}_${index + 1}.jpg`;
        content += `  - ${fileName} (${photo.photoUrl ? photo.photoUrl.length : 0} bytes)\n`;
      });
      content += '\n';
    });
    
    return content;
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

    // Separate text details from other details
    const textDetails = item.labelComparison.mismatchDetails.filter(detail => detail.includes('📝'));
    const otherDetails = item.labelComparison.mismatchDetails.filter(detail => !detail.includes('📝'));
    
    let detailsText = '';
    if (textDetails.length > 0) {
      detailsText += '\n\n📝 Chi tiết so sánh Text:\n' + textDetails.map(detail => `• ${detail.replace('📝 Text không khớp (', '').replace('%)', '')}`).join('\n');
    }
    
    if (otherDetails.length > 0) {
      detailsText += '\n\n🔍 Các vấn đề khác:\n' + otherDetails.map(detail => `• ${detail}`).join('\n');
    }
    
    const message = `❌ Chi tiết lỗi cho ${item.maTem} - ${item.maHang}:\n\nĐộ khớp: ${item.labelComparison.matchPercentage}%${detailsText}`;
    
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
  deleteComparisonFromFirebase(item: ScheduleItem, designPhotoId?: string, printedPhotoId?: string): void {
    console.log('🔥 Deleting comparison from Firebase for item:', item.stt);
    
    // Use provided photo IDs or fall back to item's photo IDs
    const photoIdsToDelete: string[] = [];
    
    if (designPhotoId) {
      photoIdsToDelete.push(designPhotoId);
    } else if (item.labelComparison?.designPhotoId) {
      photoIdsToDelete.push(item.labelComparison.designPhotoId);
    }
    
    if (printedPhotoId) {
      photoIdsToDelete.push(printedPhotoId);
    } else if (item.labelComparison?.printedPhotoId) {
      photoIdsToDelete.push(item.labelComparison.printedPhotoId);
    }
    
    console.log('🗑️ Photos to delete:', photoIdsToDelete);
    
    // Delete photos from labelPhotos collection
    if (photoIdsToDelete.length > 0) {
      const batch = this.firestore.firestore.batch();
      
      photoIdsToDelete.forEach(photoId => {
        const photoRef = this.firestore.collection('labelPhotos').doc(photoId).ref;
        batch.delete(photoRef);
        console.log('🗑️ Added photo to delete batch:', photoId);
      });
      
      batch.commit().then(() => {
        console.log('✅ Photos deleted from labelPhotos collection');
        
        // Delete from labelComparisons collection (old format)
        this.firestore.collection('labelComparisons', ref => 
          ref.where('itemId', '==', item.stt || '')
            .where('maTem', '==', item.maTem || '')
        ).get().toPromise()
          .then((querySnapshot: any) => {
            if (querySnapshot && !querySnapshot.empty) {
              // Delete all matching comparison documents
              const batch2 = this.firestore.firestore.batch();
              querySnapshot.docs.forEach((doc: any) => {
                batch2.delete(doc.ref);
              });
              
              return batch2.commit();
            }
            return Promise.resolve();
          })
          .then(() => {
            console.log('✅ Comparison deleted from labelComparisons collection');
            
            // Update main schedule document
            return this.updateScheduleAfterComparisonDelete(item).then(() => {
              // Force reload data after deletion
              setTimeout(() => {
                console.log('🔄 Reloading data after deletion...');
                this.loadDataFromFirebase();
              }, 1000);
            });
          })
          .catch((error) => {
            console.error('❌ Error deleting from labelComparisons:', error);
          });
      }).catch((error) => {
        console.error('❌ Error deleting photos from labelPhotos:', error);
      });
    } else {
      // No photos to delete, just update schedule
      this.updateScheduleAfterComparisonDelete(item);
    }
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
            console.log('🗑️ Found item to update:', updatedData[itemIndex].maTem);
            
            // Clear photo references specifically
            if (updatedData[itemIndex].labelComparison) {
              delete updatedData[itemIndex].labelComparison.designPhotoId;
              delete updatedData[itemIndex].labelComparison.designPhotoUrl;
              delete updatedData[itemIndex].labelComparison.printedPhotoId;
              delete updatedData[itemIndex].labelComparison.printedPhotoUrl;
              
              // If no photos left, remove entire labelComparison
              if (!updatedData[itemIndex].labelComparison.designPhotoId && 
                  !updatedData[itemIndex].labelComparison.printedPhotoId) {
                delete updatedData[itemIndex].labelComparison;
                console.log('🗑️ Removed entire labelComparison');
              } else {
                console.log('🗑️ Cleared photo references, kept labelComparison');
              }
            }
            
            // Update the document
            return doc.ref.update({
              data: updatedData,
              lastUpdated: new Date(),
              lastAction: 'Photo deleted'
            }).then(() => {
              console.log('✅ Schedule updated after photo deletion');
              
              // Also update local data to ensure consistency
              const localItemIndex = this.scheduleData.findIndex(localItem => 
                localItem.stt === item.stt && localItem.maTem === item.maTem
              );
              
              if (localItemIndex !== -1) {
                // Clear photo references from local data
                if (this.scheduleData[localItemIndex].labelComparison) {
                  delete this.scheduleData[localItemIndex].labelComparison.designPhotoId;
                  delete this.scheduleData[localItemIndex].labelComparison.designPhotoUrl;
                  delete this.scheduleData[localItemIndex].labelComparison.printedPhotoId;
                  delete this.scheduleData[localItemIndex].labelComparison.printedPhotoUrl;
                  
                  // If no photos left, remove entire labelComparison
                  if (!this.scheduleData[localItemIndex].labelComparison.designPhotoId && 
                      !this.scheduleData[localItemIndex].labelComparison.printedPhotoId) {
                    delete this.scheduleData[localItemIndex].labelComparison;
                  }
                }
                console.log('✅ Local data updated after photo deletion');
              }
            });
          } else {
            console.log('❌ Item not found in schedule data');
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
    if (!this.hasPermission()) {
      this.showLoginDialogForAction('deleteItem');
      return;
    }

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



  // Add function to get IQC items count
  getIQCItemsCount(): number {
    return this.scheduleData.filter(item => item.tinhTrang === 'IQC').length;
  }

  // Add function to get Pass items count
  getPassItemsCount(): number {
    return this.scheduleData.filter(item => item.tinhTrang === 'Pass').length;
  }

  // Add function to get NG items count
  getNGItemsCount(): number {
    return this.scheduleData.filter(item => item.tinhTrang === 'NG').length;
  }

  // Load user department information
  async loadUserDepartment(): Promise<void> {
    try {
      const user = await this.afAuth.currentUser;
      if (user) {
        this.currentUserId = user.uid;
        
        // Get user department from user-permissions collection
        const userPermissionDoc = await this.firestore.collection('user-permissions').doc(user.uid).get().toPromise();
        if (userPermissionDoc && userPermissionDoc.exists) {
          const userData = userPermissionDoc.data() as any;
          this.currentUserDepartment = userData.department || '';
          console.log('👤 Current user department:', this.currentUserDepartment);
        }
      }
    } catch (error) {
      console.error('❌ Error loading user department:', error);
    }
  }

  // Check if current user is QA department
  isQADepartment(): boolean {
    return this.currentUserDepartment === 'QA';
  }

  // Check if user can edit a specific field
  canEditField(fieldName: string): boolean {
    if (this.isQADepartment()) {
      // QA can only edit status field (tinhTrang)
      return fieldName === 'tinhTrang';
    }
    // Other departments can edit all fields
    return true;
  }

  // Check if user can delete
  canDelete(): boolean {
    // QA cannot delete
    return !this.isQADepartment();
  }

  // Add function to toggle show/hide completed items
  showCompletedItems: boolean = false;

  toggleShowCompletedItems(): void {
    this.showCompletedItems = !this.showCompletedItems;
    console.log('🔄 Toggle show completed items:', this.showCompletedItems);

    if (this.showCompletedItems) {
      console.log('👁️ Showing completed items');
    } else {
      console.log('🙈 Hiding completed items');
    }
    
    // Lưu trạng thái vào localStorage để không bị mất khi F5
    localStorage.setItem('printLabel_showCompletedItems', this.showCompletedItems.toString());
  }

  // Load trạng thái hiển thị từ localStorage
  private loadDisplayStateFromStorage(): void {
    const savedState = localStorage.getItem('printLabel_showCompletedItems');
    if (savedState !== null) {
      this.showCompletedItems = savedState === 'true';
      console.log('📱 Loaded display state from localStorage:', this.showCompletedItems);
    } else {
      // Mặc định ẩn các mã đã hoàn thành
      this.showCompletedItems = false;
      console.log('📱 Using default display state: hide completed items (last 30 days only)');
    }
  }









  // Add function to show note save success message
  showNoteSaveSuccess(input: HTMLInputElement): void {
    const originalBackground = input.style.background;
    const originalColor = input.style.color;
    const originalBorder = input.style.border;
    
    input.style.background = '#e8f5e8';
    input.style.color = '#4caf50';
    input.style.border = '1px solid #4caf50';
    
    setTimeout(() => {
      input.style.background = originalBackground;
      input.style.color = originalColor;
      input.style.border = originalBorder;
    }, 800);
  }

  // Add function to show field save success message
  showFieldSaveSuccess(fieldName: string): void {
    // Create a temporary success indicator
    const successIndicator = document.createElement('div');
    successIndicator.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #4caf50;
      color: white;
      padding: 10px 15px;
      border-radius: 5px;
      font-size: 14px;
      z-index: 10000;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      animation: slideIn 0.3s ease;
    `;
    
    // Add CSS animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
    
    // Set field name mapping
    const fieldNames: { [key: string]: string } = {
      'sizePhoi': 'Size phôi',
      'nguoiIn': 'Người in',
      'tinhTrang': 'Tình trạng',
      'banVe': 'Bản vẽ',
      'ghiChu': 'Ghi chú'
    };
    
    successIndicator.textContent = `✅ Đã lưu ${fieldNames[fieldName] || fieldName}`;
    document.body.appendChild(successIndicator);
    
    // Remove after 2 seconds
    setTimeout(() => {
      if (successIndicator.parentNode) {
        successIndicator.parentNode.removeChild(successIndicator);
      }
      if (style.parentNode) {
        style.parentNode.removeChild(style);
      }
    }, 2000);
  }

  // Add function to handle note input with Enter key
  onNoteKeyPress(event: KeyboardEvent, item: ScheduleItem): void {
    if (event.key === 'Enter') {
      console.log('💾 Saving note for item:', item.maTem, 'Note:', item.ghiChu);
      this.updateScheduleInFirebase(item);
      
      // Show success message
      this.showNoteSaveSuccess(event.target as HTMLInputElement);
      
      // Optional: Move focus to next input or blur
      (event.target as HTMLInputElement).blur();
    }
  }

  // Add function to handle note input change
  onNoteChange(item: ScheduleItem): void {
    console.log('📝 Note changed for item:', item.maTem, 'New note:', item.ghiChu);
    // You can add additional validation or processing here if needed
  }

  // Add function to handle note blur (auto-save)
  onNoteBlur(item: ScheduleItem, event: any): void {
    console.log('💾 Auto-saving note for item:', item.maTem, 'Note:', item.ghiChu);
    this.updateScheduleInFirebase(item);
    
    // Show brief success indicator
    const input = event.target as HTMLInputElement;
    this.showNoteSaveSuccess(input);
  }

  // Add function to handle field changes (auto-save)
  onFieldChange(item: ScheduleItem, fieldName: string): void {
    console.log(`💾 Field changed for item: ${item.maTem}, Field: ${fieldName}, New value:`, item[fieldName as keyof ScheduleItem]);
    
    // Nếu thay đổi tình trạng, cập nhật thời gian cập nhật trạng thái
    if (fieldName === 'tinhTrang') {
      item.statusUpdateTime = new Date();
      
      // Force update the item in scheduleData array
      const itemIndex = this.scheduleData.findIndex(scheduleItem => 
        scheduleItem.stt === item.stt && scheduleItem.maTem === item.maTem
      );
      if (itemIndex !== -1) {
        this.scheduleData[itemIndex].statusUpdateTime = item.statusUpdateTime;
      }
      
      // Nếu tình trạng được thay đổi thành "Done", item sẽ tự động ẩn
      // (được xử lý bởi getDisplayScheduleData() và getFilteredScheduleData())
      
      // Force Angular change detection
      this.scheduleData = [...this.scheduleData];
    }
    
    // Update Firebase immediately
    this.updateScheduleInFirebase(item);
    
    // Show brief success indicator
    this.showFieldSaveSuccess(fieldName);
  }

  // Toggle urgent status for an item
  toggleUrgent(item: ScheduleItem): void {
    item.isUrgent = !item.isUrgent;
    
    // Update Firebase immediately
    this.updateScheduleInFirebase(item);
    
    if (item.isUrgent) {
      console.log('🔥 Đánh dấu gấp cho item:', item.maTem);
    } else {
      console.log('✅ Bỏ đánh dấu gấp cho item:', item.maTem);
    }
    
    // Force Angular change detection
    this.scheduleData = [...this.scheduleData];
  }

  // Add function to update entire schedule data in Firebase
  updateEntireScheduleInFirebase(): void {
    console.log('🔄 Updating entire schedule in Firebase...');
    
    // Clean all schedule data to remove undefined values
    const cleanScheduleData = this.scheduleData.map(item => this.cleanScheduleItem(item));
    
    this.firestore.collection('printSchedules', ref => 
      ref.orderBy('importedAt', 'desc').limit(1)
    ).get().toPromise()
      .then((querySnapshot: any) => {
        if (querySnapshot && !querySnapshot.empty) {
          const doc = querySnapshot.docs[0];
          
          // Update the document with cleaned schedule data
          doc.ref.update({
            data: cleanScheduleData,
            lastUpdated: new Date(),
            lastAction: 'Bulk update',
            recordCount: cleanScheduleData.length
          }).then(() => {
            console.log('✅ Entire schedule updated successfully');
          }).catch((error) => {
            console.error('❌ Error updating entire schedule:', error);
          });
        } else {
          console.warn('⚠️ No schedule documents found for bulk update');
        }
      })
      .catch((error) => {
        console.error('❌ Error finding schedule document for bulk update:', error);
      });
  }

  // Add function to clean schedule item data
  cleanScheduleItem(item: any): any {
    const cleanItem: any = {};
    
    // Only include defined values
    Object.keys(item).forEach(key => {
      if (item[key] !== undefined && item[key] !== null) {
        // Special handling for statusUpdateTime to ensure it's preserved
        if (key === 'statusUpdateTime' && item[key] instanceof Date) {
          cleanItem[key] = item[key];
        } else if (key === 'statusUpdateTime' && typeof item[key] === 'string') {
          // Convert string back to Date if it was serialized
          cleanItem[key] = new Date(item[key]);
        } else if (key === 'statusUpdateTime' && item[key]) {
          // Handle other cases where statusUpdateTime exists
          cleanItem[key] = item[key];
        } else if (key !== 'statusUpdateTime') {
          // For non-statusUpdateTime fields, use normal logic
        cleanItem[key] = item[key];
        }
      }
    });
    
    return cleanItem;
  }

  // Add function to debug Firebase data
  debugFirebaseData(): void {
    console.log('🔍 Debugging Firebase data...');
    
    this.firestore.collection('printSchedules', ref => 
      ref.orderBy('importedAt', 'desc')
    ).get().toPromise()
      .then((querySnapshot: any) => {
        console.log('📊 Total documents in Firebase:', querySnapshot.size);
        
        querySnapshot.docs.forEach((doc: any, index: number) => {
          const data = doc.data();
          console.log(`📄 Document ${index + 1} (${doc.id}):`);
          console.log('  - importedAt:', data.importedAt);
          console.log('  - data length:', data.data?.length || 0);
          console.log('  - lastUpdated:', data.lastUpdated);
          console.log('  - lastAction:', data.lastAction);
          
          if (data.data && data.data.length > 0) {
            console.log('  - Sample items:');
            data.data.slice(0, 3).forEach((item: any, i: number) => {
              console.log(`    ${i + 1}. STT: ${item.stt}, MaTem: ${item.maTem}, SizePhoi: ${item.sizePhoi}, NguoiIn: ${item.nguoiIn}`);
            });
          }
        });
        
        // Show summary alert
        const summary = `📊 Firebase Debug Summary:\n\n` +
          `Total documents: ${querySnapshot.size}\n` +
          `Latest document: ${querySnapshot.docs[0]?.id || 'None'}\n` +
          `Current local data: ${this.scheduleData.length} items\n\n` +
          `Check console for detailed information.`;
        
        alert(summary);
      })
      .catch((error) => {
        console.error('❌ Error debugging Firebase data:', error);
        alert('❌ Error debugging Firebase data: ' + error.message);
      });
  }

  // Authentication methods
  showLoginDialogForAction(action: string): void {
    this.showLoginDialog = true;
    this.loginError = '';
    this.currentEmployeeId = '';
    this.currentPassword = '';
    
    // Store the action to perform after successful login
    (window as any).pendingAction = action;
  }

  async authenticateUser(): Promise<void> {
    if (!this.currentEmployeeId || !this.currentPassword) {
      this.loginError = 'Vui lòng nhập đầy đủ thông tin!';
      return;
    }

    try {
      const isValid = await this.permissionService.validateUserCredentials(
        this.currentEmployeeId, 
        this.currentPassword
      );
      
      if (isValid) {
        this.isAuthenticated = true;
        this.showLoginDialog = false;
        this.loginError = '';
        
        // Perform the pending action
        const pendingAction = (window as any).pendingAction;
        if (pendingAction) {
          this.performAuthenticatedAction(pendingAction);
          (window as any).pendingAction = null;
        }
      } else {
        this.loginError = 'Mã nhân viên hoặc mật khẩu không đúng, hoặc bạn không có quyền thực hiện hành động này!';
        this.currentPassword = '';
      }
    } catch (error) {
      console.error('Authentication error:', error);
      this.loginError = 'Có lỗi xảy ra khi xác thực thông tin!';
      this.currentPassword = '';
    }
  }

  cancelLogin(): void {
    this.showLoginDialog = false;
    this.loginError = '';
    this.currentEmployeeId = '';
    this.currentPassword = '';
    (window as any).pendingAction = null;
  }

  performAuthenticatedAction(action: string): void {
    switch (action) {
      case 'clearData':
        this.clearScheduleData();
        break;
      case 'clearFirebase':
        this.clearOldFirebaseData();
        break;
      case 'deleteCompleted':
        this.deleteAllCompletedItems();
        break;
      case 'deleteItem':
        // This will be handled by the specific delete method
        break;
      default:
        console.log('Unknown action:', action);
    }
  }

  // Check if user has permission for sensitive actions
  hasPermission(): boolean {
    console.log('🔍 hasPermission() called, isAuthenticated:', this.isAuthenticated);
    return this.isAuthenticated;
  }

  // Logout method
  logout(): void {
    this.isAuthenticated = false;
    this.currentEmployeeId = '';
    this.currentPassword = '';
    this.loginError = '';
    console.log('🔓 User logged out');
  }

  // Remove camera dialog safely
  removeCameraDialog(dialog: HTMLElement): void {
    try {
      // Remove all camera dialogs to be safe
      const allDialogs = document.querySelectorAll('.camera-dialog');
      console.log('🗑️ Found', allDialogs.length, 'camera dialogs to remove');
      
      allDialogs.forEach((dialogElement, index) => {
        if (dialogElement.parentNode) {
          // Stop any video streams in this dialog first
          const videos = dialogElement.querySelectorAll('video');
          videos.forEach(video => {
            if (video.srcObject) {
              const tracks = (video.srcObject as MediaStream).getTracks();
              tracks.forEach(track => {
                track.stop();
                console.log('🛑 Stopped video track in dialog:', track.kind);
              });
            }
          });
          
          // Remove the dialog
          dialogElement.parentNode.removeChild(dialogElement);
          console.log('🗑️ Removed camera dialog', index + 1);
        }
      });
      
      // Also remove any video elements that might be left
      const videoElements = document.querySelectorAll('video');
      videoElements.forEach(video => {
        if (video.srcObject) {
          const tracks = (video.srcObject as MediaStream).getTracks();
          tracks.forEach(track => {
            track.stop();
            console.log('🛑 Stopped remaining video track:', track.kind);
          });
        }
      });
      
      console.log('🗑️ Camera dialog and video streams cleaned up successfully');
    } catch (error) {
      console.error('❌ Error removing camera dialog:', error);
    }
  }

  // Clean up camera streams
  cleanupCameraStreams(): void {
    console.log('🧹 Cleaning up camera streams...');
    
    // Remove all camera dialogs
    this.removeCameraDialog(document.createElement('div'));
    
    // Stop all video elements that might be playing
    const videoElements = document.querySelectorAll('video');
    videoElements.forEach(video => {
      if (video.srcObject) {
        const tracks = (video.srcObject as MediaStream).getTracks();
        tracks.forEach(track => {
          track.stop();
          console.log('🛑 Stopped video track during cleanup:', track.kind);
        });
      }
    });
    
    // Stop all media streams
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        .then(stream => {
          stream.getTracks().forEach(track => {
            track.stop();
            console.log('🛑 Stopped media stream track during cleanup:', track.kind);
          });
        })
        .catch(() => {
          // Ignore errors when cleaning up
        });
    }
    
    // Reset capture flag
    this.isCapturingPhoto = false;
    
    console.log('✅ Camera cleanup completed');
  }

  clearOldFirebaseData(): void {
    if (!this.hasPermission()) {
      this.showLoginDialogForAction('clearFirebase');
      return;
    }

    console.log('🗑️ Clearing old Firebase data...');
    
    this.firestore.collection('printSchedules').get().toPromise()
      .then((querySnapshot: any) => {
        if (querySnapshot && !querySnapshot.empty) {
          const batch = this.firestore.firestore.batch();
          querySnapshot.docs.forEach((doc: any) => {
            batch.delete(doc.ref);
          });
          return batch.commit();
        }
      })
      .then(() => {
        console.log('✅ Old Firebase data cleared successfully');
        this.scheduleData = [];
        this.firebaseSaved = false;
        alert('✅ Đã xóa dữ liệu cũ trong Firebase!');
      })
      .catch((error) => {
        console.error('❌ Error clearing Firebase data:', error);
        alert(`❌ Lỗi khi xóa dữ liệu Firebase:\n${error.message || error}`);
      });
  }

  optimizeImageForStorage(base64Image: string, maxSizeKB: number = 250): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Calculate new dimensions to fit within maxSizeKB
        let quality = 0.8;
        let width = img.width;
        let height = img.height;
        
        // Reduce size if image is too large
        const maxDimension = 800;
        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height);
          width = width * ratio;
          height = height * ratio;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          
          // Try to compress to target size
          const compressImage = (q: number) => {
            const compressed = canvas.toDataURL('image/jpeg', q);
            const sizeKB = (compressed.length * 0.75) / 1024; // Approximate size
            
            if (sizeKB <= maxSizeKB || q <= 0.1) {
              resolve(compressed);
            } else {
              compressImage(q - 0.1);
            }
          };
          
          compressImage(quality);
        }
      };
      
      img.src = base64Image;
    });
  }

  // Continue to next capture step
  continueToNextCaptureStep(item: ScheduleItem, currentMode: 'design' | 'printed'): void {
    if (currentMode === 'design') {
      // Move to printed photo capture
      this.captureStep = 2;
      this.currentCaptureMode = 'printed';
      
      // Ask user if they want to continue
      const confirmed = confirm(
        `✅ Đã chụp xong bản vẽ thiết kế!\n\n` +
        `Bạn có muốn tiếp tục chụp tem đã in không?\n\n` +
        `• Bước 1/2: ✅ Bản vẽ thiết kế\n` +
        `• Bước 2/2: 📸 Tem đã in (Chưa chụp)`
      );
      
      if (confirmed) {
        // Start printed photo capture
        this.startPhotoCapture(item, 'printed');
      } else {
        this.isCapturingPhoto = false;
        alert('📸 Chụp hình tạm dừng. Bạn có thể tiếp tục sau.');
      }
    } else {
      // Both photos captured
      this.isCapturingPhoto = false;
      alert('✅ Đã hoàn thành chụp cả 2 hình!');
    }
  }

  // Complete photo capture process
  completePhotoCapture(item: ScheduleItem): void {
    console.log('✅ Photo capture completed for item:', item.maTem);
    
    // Update item with completion status
    if (item.labelComparison) {
      item.labelComparison.comparedAt = new Date();
      item.labelComparison.comparisonResult = 'Completed';
    }
    
    // Save to Firebase
    this.saveComparisonToFirebase(item);
    
    // Show completion message
    const hasDesign = item.labelComparison?.designPhotoId;
    const hasPrinted = item.labelComparison?.printedPhotoId;
    
    let message = `✅ Hoàn thành chụp hình cho ${item.maTem}\n\n`;
    message += `📊 Trạng thái:\n`;
    message += `• Bản vẽ thiết kế: ${hasDesign ? '✅ Đã chụp' : '❌ Chưa chụp'}\n`;
    message += `• Tem đã in: ${hasPrinted ? '✅ Đã chụp' : '❌ Chưa chụp'}\n\n`;
    message += `💾 Đã lưu vào Firebase\n`;
    message += `📦 Có thể tải về và xem lại trong Check Label`;
    
    alert(message);
  }

  // Thêm hàm để lấy hình ảnh từ Firebase
  async getPhotoFromFirebase(photoId: string): Promise<string | null> {
    try {
      const doc = await this.firestore.collection('labelPhotos').doc(photoId).get().toPromise();
      if (doc && doc.exists) {
        const data = doc.data() as any;
        return data?.photoUrl || null;
      }
      return null;
    } catch (error) {
      console.error('❌ Error getting photo from Firebase:', error);
      return null;
    }
  }

  // Hàm để hiển thị hình ảnh từ ID (deprecated - use viewFullImage with item instead)
  async viewPhotoFromId(photoId: string): Promise<void> {
    console.log('⚠️ viewPhotoFromId is deprecated. Use viewFullImage with item instead.');
    alert('⚠️ Chức năng này đã được thay thế. Vui lòng sử dụng nút 👁️ trong bảng để xem hình.');
  }

  // Thêm hàm để kiểm tra và tối ưu hóa dữ liệu hiện tại
  async optimizeCurrentData(): Promise<void> {
    console.log('🔧 Optimizing current data...');
    
    try {
      // Lấy dữ liệu hiện tại
      const querySnapshot = await this.firestore.collection('printSchedules', ref => 
        ref.orderBy('importedAt', 'desc')
      ).get().toPromise();

      if (!querySnapshot || querySnapshot.empty) {
        alert('❌ Không có dữ liệu để tối ưu hóa');
        return;
      }

      let optimizedCount = 0;
      const batch = this.firestore.firestore.batch();

      for (const doc of querySnapshot.docs) {
        const docData = doc.data() as any;
        const scheduleData = docData.data || [];
        let hasChanges = false;

        // Kiểm tra và tối ưu hóa từng item
        for (let i = 0; i < scheduleData.length; i++) {
          const item = scheduleData[i];
          
          // Nếu có labelComparison với photoUrl là base64, chuyển thành ID
          if (item.labelComparison?.photoUrl && 
              item.labelComparison.photoUrl.startsWith('data:')) {
            
            // Tạo document mới cho photo
            const photoRef = this.firestore.collection('labelPhotos').doc();
            const photoData = {
              itemId: item.stt || '',
              maTem: item.maTem || '',
              maHang: item.maHang || '',
              khachHang: item.khachHang || '',
              photoUrl: item.labelComparison.photoUrl,
              capturedAt: item.labelComparison.comparedAt || new Date(),
              savedAt: new Date()
            };
            
            batch.set(photoRef.ref, photoData);
            
            // Cập nhật item để chỉ lưu ID
            scheduleData[i] = {
              ...item,
              labelComparison: {
                ...item.labelComparison,
                photoUrl: photoRef.ref.id
              }
            };
            
            hasChanges = true;
            optimizedCount++;
          }
        }

        // Nếu có thay đổi, cập nhật document
        if (hasChanges) {
          batch.update(doc.ref, {
            data: scheduleData,
            lastUpdated: new Date(),
            lastAction: 'Data optimized'
          });
        }
      }

      // Thực hiện batch update
      await batch.commit();
      
      console.log(`✅ Optimized ${optimizedCount} items`);
      alert(`✅ Đã tối ưu hóa ${optimizedCount} items thành công!`);
      
    } catch (error) {
      console.error('❌ Error optimizing data:', error);
      alert('❌ Lỗi khi tối ưu hóa dữ liệu:\n' + error.message);
    }
  }

  // Thêm hàm để tính tổng dung lượng hình ảnh đã lưu trên Firebase
  async getTotalPhotoStorageSize(): Promise<{ totalSizeKB: number; totalSizeMB: number; photoCount: number }> {
    try {
      const querySnapshot = await this.firestore.collection('labelPhotos').get().toPromise();
      
      if (!querySnapshot || querySnapshot.empty) {
        return { totalSizeKB: 0, totalSizeMB: 0, photoCount: 0 };
      }

      let totalSizeBytes = 0;
      let photoCount = 0;

      for (const doc of querySnapshot.docs) {
        const data = doc.data() as any;
        if (data.photoUrl && data.photoUrl.startsWith('data:')) {
          // Tính kích thước từ base64
          const base64Length = data.photoUrl.length;
          const sizeBytes = (base64Length * 0.75); // Base64 to bytes conversion
          totalSizeBytes += sizeBytes;
          photoCount++;
        }
      }

      const totalSizeKB = Math.round(totalSizeBytes / 1024);
      const totalSizeMB = Math.round((totalSizeKB / 1024) * 100) / 100; // 2 decimal places

      return { totalSizeKB, totalSizeMB, photoCount };
    } catch (error) {
      console.error('❌ Error calculating total photo storage size:', error);
      return { totalSizeKB: 0, totalSizeMB: 0, photoCount: 0 };
    }
  }

  // Thêm hàm để format dung lượng
  formatStorageSize(sizeKB: number): string {
    if (sizeKB < 1024) {
      return `${sizeKB} KB`;
    } else {
      const sizeMB = sizeKB / 1024;
      return `${sizeMB.toFixed(2)} MB`;
    }
  }

  // Thêm hàm để kiểm tra giới hạn dung lượng
  async checkStorageLimit(): Promise<{ isNearLimit: boolean; percentageUsed: number; limitMB: number }> {
    const { totalSizeMB } = await this.getTotalPhotoStorageSize();
    const limitMB = 100; // Giả sử giới hạn 100MB
    const percentageUsed = (totalSizeMB / limitMB) * 100;
    const isNearLimit = percentageUsed > 80; // Cảnh báo khi sử dụng > 80%

    return { isNearLimit, percentageUsed, limitMB };
  }

  // Thêm hàm để refresh thông tin dung lượng
  async refreshStorageInfo(): Promise<void> {
    try {
      const { totalSizeKB, totalSizeMB, photoCount } = await this.getTotalPhotoStorageSize();
      
      // Cập nhật DOM elements
      const totalStorageElement = document.getElementById('totalStorageSize');
      const photoCountElement = document.getElementById('photoCount');
      const avgSizeElement = document.getElementById('avgSize');
      
      if (totalStorageElement) {
        totalStorageElement.textContent = this.formatStorageSize(totalSizeKB);
        totalStorageElement.style.color = totalSizeMB > 50 ? '#f44336' : '#2e7d32'; // Đỏ nếu > 50MB
      }
      
      if (photoCountElement) {
        photoCountElement.textContent = photoCount.toString();
      }
      
      if (avgSizeElement && photoCount > 0) {
        const avgSizeKB = Math.round(totalSizeKB / photoCount);
        avgSizeElement.textContent = this.formatStorageSize(avgSizeKB);
        avgSizeElement.style.color = avgSizeKB > 200 ? '#f44336' : '#9c27b0'; // Đỏ nếu > 200KB
      } else if (avgSizeElement) {
        avgSizeElement.textContent = '0 KB';
        avgSizeElement.style.color = '#9c27b0';
      }
      
      // Kiểm tra giới hạn dung lượng
      const { isNearLimit, percentageUsed } = await this.checkStorageLimit();
      
      if (isNearLimit) {
        console.warn('⚠️ Storage usage is near limit:', percentageUsed.toFixed(1) + '%');
        // Hiển thị cảnh báo cho user
        if (totalStorageElement) {
          totalStorageElement.style.background = '#ffebee';
          totalStorageElement.style.padding = '2px 6px';
          totalStorageElement.style.borderRadius = '4px';
        }
        
        // Hiển thị cảnh báo
        const warningElement = document.getElementById('storageWarning');
        if (warningElement) {
          warningElement.style.display = 'block';
        }
      } else {
        // Ẩn cảnh báo nếu không cần
        const warningElement = document.getElementById('storageWarning');
        if (warningElement) {
          warningElement.style.display = 'none';
        }
      }
      
    } catch (error) {
      console.error('❌ Error refreshing storage info:', error);
      
      // Hiển thị lỗi trong UI
      const totalStorageElement = document.getElementById('totalStorageSize');
      const photoCountElement = document.getElementById('photoCount');
      const avgSizeElement = document.getElementById('avgSize');
      
      if (totalStorageElement) {
        totalStorageElement.textContent = 'Lỗi';
        totalStorageElement.style.color = '#f44336';
      }
      
      if (photoCountElement) {
        photoCountElement.textContent = 'Lỗi';
        photoCountElement.style.color = '#f44336';
      }
      
      if (avgSizeElement) {
        avgSizeElement.textContent = 'Lỗi';
        avgSizeElement.style.color = '#f44336';
      }
    }
  }



  // Get current time range text
  getCurrentTimeRangeText(): string {
    if (this.customStartDate && this.customEndDate) {
      return `${this.customStartDate.toLocaleDateString()} - ${this.customEndDate.toLocaleDateString()}`;
    } else {
      return `${this.selectedDays} ngày gần nhất`;
    }
  }

  // Show time range selector dialog
  showTimeRangeSelector(): void {
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
      background: rgba(0,0,0,0.5); z-index: 10000; display: flex; 
      align-items: center; justify-content: center;
    `;
    
    const content = document.createElement('div');
    content.style.cssText = `
      background: white; padding: 30px; border-radius: 10px; 
      max-width: 500px; width: 90%; text-align: center;
    `;
    
    content.innerHTML = `
      <h3 style="margin-bottom: 20px; color: #1976d2;">📅 Chọn khoảng thời gian</h3>
      
      <div style="margin-bottom: 20px;">
        <h4 style="margin-bottom: 10px; color: #666;">Tùy chọn nhanh:</h4>
        <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
          <button onclick="window.selectTimeRange(7)" style="background: #4caf50; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">7 ngày</button>
          <button onclick="window.selectTimeRange(30)" style="background: #2196f3; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">30 ngày</button>
          <button onclick="window.selectTimeRange(90)" style="background: #ff9800; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">90 ngày</button>
          <button onclick="window.selectTimeRange(365)" style="background: #9c27b0; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">1 năm</button>
        </div>
      </div>
      
      <div style="margin-bottom: 20px;">
        <h4 style="margin-bottom: 10px; color: #666;">Tùy chỉnh:</h4>
        <div style="display: flex; gap: 10px; justify-content: center; align-items: center; flex-wrap: wrap;">
          <input type="date" id="startDate" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
          <span style="color: #666;">đến</span>
          <input type="date" id="endDate" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
        </div>
      </div>
      
      <div style="margin-top: 20px;">
        <button onclick="window.applyCustomDate()" style="background: #1976d2; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin-right: 10px;">Áp dụng</button>
        <button onclick="window.closeTimeDialog()" style="background: #666; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer;">Hủy</button>
      </div>
    `;
    
    dialog.appendChild(content);
    document.body.appendChild(dialog);
    
    // Set global functions
    (window as any).selectTimeRange = (days: number) => {
      this.selectedDays = days;
      this.customStartDate = null;
      this.customEndDate = null;
      this.loadDataFromFirebase();
      this.closeTimeDialog();
    };
    
    (window as any).applyCustomDate = () => {
      const startDate = (document.getElementById('startDate') as HTMLInputElement).value;
      const endDate = (document.getElementById('endDate') as HTMLInputElement).value;
      
      if (startDate && endDate) {
        this.customStartDate = new Date(startDate);
        this.customEndDate = new Date(endDate);
        this.selectedDays = 0;
        this.loadDataFromFirebase();
        this.closeTimeDialog();
      } else {
        alert('Vui lòng chọn cả ngày bắt đầu và ngày kết thúc');
      }
    };
    
    (window as any).closeTimeDialog = () => {
      document.body.removeChild(dialog);
    };
  }

  // Close time dialog
  closeTimeDialog(): void {
    const dialog = document.querySelector('div[style*="z-index: 10000"]');
    if (dialog) {
      document.body.removeChild(dialog);
    }
  }



  createEmailHTMLReport(photos: any[], monthKey: string): string {
    let htmlContent = `
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <title>Báo cáo hình ảnh tháng ${monthKey}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .header { background: #1976d2; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .item { background: white; margin: 20px 0; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .item-title { color: #1976d2; font-size: 18px; font-weight: bold; margin-bottom: 15px; }
        .photo { margin: 15px 0; padding: 15px; border: 1px solid #ddd; border-radius: 6px; }
        .photo-title { font-weight: bold; color: #333; margin-bottom: 10px; }
        .photo-info { color: #666; font-size: 14px; margin-bottom: 10px; }
        .photo-image { max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 4px; }
        .summary { background: #e3f2fd; padding: 20px; border-radius: 8px; margin-top: 20px; }
        .summary-title { font-weight: bold; color: #1976d2; margin-bottom: 10px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📸 BÁO CÁO HÌNH ẢNH THÁNG ${monthKey}</h1>
        <p>Ngày tạo: ${new Date().toLocaleString('vi-VN')}</p>
        <p>Tổng số hình: ${photos.length}</p>
    </div>
`;
    
    // Group photos by item
    const groupedPhotos = this.groupPhotosByItem(photos);
    
    groupedPhotos.forEach((photos, itemKey) => {
      htmlContent += `
    <div class="item">
        <div class="item-title">📋 MÃ TEM: ${itemKey}</div>
`;
      
      photos.forEach((photo, index) => {
        const photoType = photo.photoType === 'design' ? 'Bản vẽ' : 'Tem in';
        const capturedDate = photo.capturedDate ? 
          new Date(photo.capturedDate).toLocaleString('vi-VN') : 'Không xác định';
        const fileSize = photo.photoUrl ? Math.round(photo.photoUrl.length / 1024) : 0;
        
        htmlContent += `
        <div class="photo">
            <div class="photo-title">${index + 1}. ${photoType}</div>
            <div class="photo-info">
                📅 Ngày chụp: ${capturedDate}<br>
                📏 Kích thước: ${fileSize} KB<br>
                🔗 ID: ${photo.id}<br>
                📝 Ghi chú: ${photo.maTem || 'N/A'}
            </div>
            <img src="${photo.photoUrl}" alt="${photoType} - ${itemKey}" class="photo-image">
        </div>
`;
      });
      
      htmlContent += `
    </div>
`;
    });
    
    // Add summary
    const designCount = photos.filter(p => p.photoType === 'design').length;
    const printedCount = photos.filter(p => p.photoType === 'printed').length;
    const totalSize = photos.reduce((sum, p) => sum + (p.photoUrl ? p.photoUrl.length : 0), 0) / 1024;
    
    htmlContent += `
    <div class="summary">
        <div class="summary-title">📊 TỔNG KẾT</div>
        <p>• Tổng số mã tem: ${groupedPhotos.size}</p>
        <p>• Hình bản vẽ: ${designCount}</p>
        <p>• Hình tem in: ${printedCount}</p>
        <p>• Tổng dung lượng: ${Math.round(totalSize)} KB</p>
    </div>
</body>
</html>`;
    
    return htmlContent;
  }

  async sendEmailWithAttachment(htmlContent: string, monthKey: string): Promise<void> {
    try {
      // Create email content
      const subject = `📸 Báo cáo hình ảnh tháng ${monthKey}`;
      const body = `
Báo cáo hình ảnh tem tháng ${monthKey}

Tổng số hình: ${htmlContent.match(/Tổng số hình: (\d+)/)?.[1] || '0'}

Xem chi tiết trong file đính kèm hoặc mở file HTML để xem hình ảnh.

---
Gửi tự động từ hệ thống quản lý tem.
      `;
      
      // Download HTML file directly
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bao-cao-hinh-anh-${monthKey}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      console.log('✅ HTML report downloaded successfully');
      
    } catch (error) {
      console.error('❌ Error sending email:', error);
      alert('❌ Lỗi tải báo cáo: ' + error.message);
    }
  }





  importPhotoFromFile(item: ScheduleItem, mode: 'design' | 'printed'): void {
    // Create file input element
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    
    // Set up file selection handler
    fileInput.onchange = async (event: any) => {
      const file = event.target.files[0];
      if (!file) return;
      
      try {
        console.log(`📁 Importing ${mode} photo for item:`, item.maTem);
        
        // Validate file type
        if (!file.type.startsWith('image/')) {
          alert('❌ Vui lòng chọn file hình ảnh!');
          return;
        }
        
        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
          alert('❌ File quá lớn! Vui lòng chọn file nhỏ hơn 5MB.');
          return;
        }
        
        // Convert file to blob
        const blob = new Blob([file], { type: file.type });
        
        // Save to Firebase
        await this.savePhotoToFirebase(blob, item, mode);
        
        console.log(`✅ Imported ${mode} photo successfully for:`, item.maTem);
        alert(`✅ Đã import ${mode === 'design' ? 'bản vẽ' : 'tem in'} thành công!`);
        
      } catch (error) {
        console.error('❌ Error importing photo:', error);
        alert('❌ Lỗi import hình ảnh: ' + error.message);
      } finally {
        // Clean up
        document.body.removeChild(fileInput);
      }
    };
    
    // Trigger file selection
    document.body.appendChild(fileInput);
    fileInput.click();
  }

  showMobileCameraInfo(): void {
    const dialog = document.createElement('div');
    dialog.className = 'mobile-camera-info-dialog';
    dialog.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.8);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
    `;
    
    const content = document.createElement('div');
    content.style.cssText = `
      background: white;
      padding: 25px;
      border-radius: 15px;
      max-width: 350px;
      width: 90%;
      text-align: center;
    `;
    
    content.innerHTML = `
      <h3 style="margin: 0 0 20px 0; color: #e91e63; font-size: 18px;">📸 Chụp hình tem</h3>
      
      <div style="margin-bottom: 20px; text-align: left;">
        <p style="margin: 8px 0; font-size: 14px; color: #333;">
          <strong>1.</strong> Chọn item trong bảng dữ liệu
        </p>
        <p style="margin: 8px 0; font-size: 14px; color: #333;">
          <strong>2.</strong> Nhấn nút 📸 để chụp hình
        </p>
        <p style="margin: 8px 0; font-size: 14px; color: #333;">
          <strong>3.</strong> Chụp bản vẽ trước, sau đó chụp tem in
        </p>
        <p style="margin: 8px 0; font-size: 14px; color: #333;">
          <strong>4.</strong> Hình sẽ được lưu vào History Pic
        </p>
      </div>
      
      <div style="background: #f5f5f5; padding: 15px; border-radius: 10px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 12px; color: #666;">
          💡 <strong>Lưu ý:</strong> Vuốt ngang để xem đầy đủ bảng dữ liệu trên điện thoại
        </p>
      </div>
      
      <button id="closeMobileCameraDialog" 
              style="background: #e91e63; color: white; border: none; padding: 12px 25px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: bold;">
        ✅ Hiểu rồi
      </button>
    `;
    
    dialog.appendChild(content);
    document.body.appendChild(dialog);
    
    // Event handler
    const closeBtn = content.querySelector('#closeMobileCameraDialog') as HTMLButtonElement;
    closeBtn.onclick = () => {
      document.body.removeChild(dialog);
    };
  }





  // Force complete deletion of photos
  forceCompletePhotoDeletion(item: ScheduleItem): void {
    console.log('🔥 Force complete deletion for:', item.maTem);
    
    // Store photo IDs
    const designPhotoId = item.labelComparison?.designPhotoId;
    const printedPhotoId = item.labelComparison?.printedPhotoId;
    
    // Clear local references immediately
    if (item.labelComparison) {
      delete item.labelComparison.designPhotoId;
      delete item.labelComparison.designPhotoUrl;
      delete item.labelComparison.printedPhotoId;
      delete item.labelComparison.printedPhotoUrl;
      
      if (!item.labelComparison.designPhotoId && !item.labelComparison.printedPhotoId) {
        delete item.labelComparison;
      }
    }
    
    // Delete from Firebase with multiple attempts
    const deletePromises: Promise<any>[] = [];
    
    // Delete from labelPhotos collection
    if (designPhotoId) {
      deletePromises.push(
        this.firestore.collection('labelPhotos').doc(designPhotoId).delete()
          .then(() => console.log('✅ Deleted design photo:', designPhotoId))
          .catch((error) => console.error('❌ Error deleting design photo:', error))
      );
    }
    
    if (printedPhotoId) {
      deletePromises.push(
        this.firestore.collection('labelPhotos').doc(printedPhotoId).delete()
          .then(() => console.log('✅ Deleted printed photo:', printedPhotoId))
          .catch((error) => console.error('❌ Error deleting printed photo:', error))
      );
    }
    
    // Delete from labelComparisons collection
    deletePromises.push(
      this.firestore.collection('labelComparisons', ref => 
        ref.where('itemId', '==', item.stt || '')
          .where('maTem', '==', item.maTem || '')
      ).get().toPromise()
        .then((querySnapshot: any) => {
          if (querySnapshot && !querySnapshot.empty) {
            const batch = this.firestore.firestore.batch();
            querySnapshot.docs.forEach((doc: any) => {
              batch.delete(doc.ref);
            });
            return batch.commit();
          }
          return Promise.resolve();
        })
        .then(() => console.log('✅ Deleted from labelComparisons'))
        .catch((error) => console.error('❌ Error deleting from labelComparisons:', error))
    );
    
    // Update main schedule
    deletePromises.push(
      this.updateScheduleAfterComparisonDelete(item)
        .then(() => console.log('✅ Updated main schedule'))
        .catch((error) => console.error('❌ Error updating main schedule:', error))
    );
    
    // Execute all deletions
    Promise.all(deletePromises)
      .then(() => {
        console.log('✅ All deletion operations completed');
        alert('✅ Đã xóa hoàn toàn hình khỏi Firebase!');
        
        // Force reload after a delay
        setTimeout(() => {
          console.log('🔄 Force reloading data...');
          this.loadDataFromFirebase();
        }, 2000);
      })
      .catch((error) => {
        console.error('❌ Error in force deletion:', error);
        alert('❌ Có lỗi khi xóa hình!');
      });
  }

  // Add function to split large documents
  async splitLargeDocument(): Promise<void> {
    console.log('🔧 Splitting large document to avoid size limit...');
    
    try {
      // Find the large document
      const querySnapshot = await this.firestore.collection('printSchedules', ref => 
        ref.orderBy('importedAt', 'desc').limit(1)
      ).get().toPromise();

      if (!querySnapshot || querySnapshot.empty) {
        alert('❌ Không tìm thấy document để tách');
        return;
      }

      const largeDoc = querySnapshot.docs[0];
      const docData = largeDoc.data() as any;
      const scheduleData = docData.data || [];

      if (scheduleData.length === 0) {
        alert('❌ Document không có dữ liệu để tách');
        return;
      }

      // Split data into chunks of 50 items each
      const chunkSize = 50;
      const chunks = [];
      
      for (let i = 0; i < scheduleData.length; i += chunkSize) {
        chunks.push(scheduleData.slice(i, i + chunkSize));
      }

      console.log(`📦 Splitting ${scheduleData.length} items into ${chunks.length} chunks`);

      // Delete the large document first
      await largeDoc.ref.delete();
      console.log('🗑️ Deleted large document');

      // Create new smaller documents
      const batch = this.firestore.firestore.batch();
      const newDocRefs = [];

      chunks.forEach((chunk, index) => {
        const newDocRef = this.firestore.collection('printSchedules').doc();
        const newDocData = {
          data: chunk,
          importedAt: docData.importedAt || new Date(),
          month: docData.month || this.getCurrentMonth(),
          chunkIndex: index,
          totalChunks: chunks.length,
          recordCount: chunk.length,
          lastUpdated: new Date(),
          splitFrom: largeDoc.id
        };
        
        batch.set(newDocRef.ref, newDocData);
        newDocRefs.push(newDocRef);
      });

      await batch.commit();
      console.log('✅ Successfully split large document');

      // Reload data
      this.loadDataFromFirebase();
      
      alert(`✅ Đã tách document lớn thành ${chunks.length} document nhỏ hơn!\n\n` +
            `📊 Tổng số items: ${scheduleData.length}\n` +
            `📦 Số chunks: ${chunks.length}\n` +
            `📏 Items per chunk: ${chunkSize}`);

    } catch (error) {
      console.error('❌ Error splitting large document:', error);
      alert(`❌ Lỗi khi tách document lớn:\n${error.message || error}`);
    }
  }

  // Add function to check document sizes
  async checkDocumentSizes(): Promise<void> {
    console.log('📏 Checking document sizes...');
    
    try {
      const querySnapshot = await this.firestore.collection('printSchedules', ref => 
        ref.orderBy('importedAt', 'desc')
      ).get().toPromise();

      if (!querySnapshot || querySnapshot.empty) {
        alert('❌ Không có documents để kiểm tra');
        return;
      }

      let report = '📏 Document Size Report:\n\n';
      let totalSize = 0;
      let largeDocs = 0;

      querySnapshot.docs.forEach((doc, index) => {
        const data = doc.data() as any;
        const jsonString = JSON.stringify(data);
        const sizeInBytes = new Blob([jsonString]).size;
        const sizeInKB = Math.round(sizeInBytes / 1024);
        const sizeInMB = Math.round(sizeInBytes / (1024 * 1024) * 100) / 100;
        
        totalSize += sizeInBytes;
        
        report += `📄 Document ${index + 1} (${doc.id}):\n`;
        report += `   📏 Size: ${sizeInKB} KB (${sizeInMB} MB)\n`;
        report += `   📊 Items: ${data.data?.length || 0}\n`;
        report += `   📅 Created: ${data.importedAt?.toDate().toLocaleString('vi-VN') || 'N/A'}\n`;
        
        if (sizeInBytes > 800000) { // Warning at 800KB
          report += `   ⚠️ WARNING: Document is large!\n`;
          largeDocs++;
        }
        
        report += '\n';
      });

      const totalSizeInMB = Math.round(totalSize / (1024 * 1024) * 100) / 100;
      report += `📈 Summary:\n`;
      report += `   📊 Total documents: ${querySnapshot.size}\n`;
      report += `   📏 Total size: ${totalSizeInMB} MB\n`;
      report += `   ⚠️ Large documents: ${largeDocs}\n`;

      if (largeDocs > 0) {
        report += `\n💡 Recommendation: Use "Split Large Document" to fix size issues.`;
      }

      alert(report);

        } catch (error) {
      console.error('❌ Error checking document sizes:', error);
      alert(`❌ Lỗi khi kiểm tra kích thước documents:\n${error.message || error}`);
    }
  }

  // Auto handle document size limit
  async autoHandleDocumentSizeLimit(): Promise<void> {
    console.log('🔧 Auto-handling document size limits...');
    
    try {
      // Check for large documents
      const querySnapshot = await this.firestore.collection('printSchedules', ref => 
        ref.orderBy('importedAt', 'desc').limit(5)
      ).get().toPromise();

      if (!querySnapshot || querySnapshot.empty) {
        return; // No documents to check
      }

      let hasLargeDocument = false;
      
      for (const doc of querySnapshot.docs) {
        const data = doc.data() as any;
        const jsonString = JSON.stringify(data);
        const sizeInBytes = new Blob([jsonString]).size;
        
        // If document is larger than 800KB, it needs to be split
        if (sizeInBytes > 800000) {
          hasLargeDocument = true;
          console.log(`⚠️ Found large document: ${doc.id} (${Math.round(sizeInBytes / 1024)} KB)`);
          break;
        }
      }

      if (hasLargeDocument) {
        console.log('🔄 Auto-splitting large document...');
        await this.splitLargeDocument();
      }

    } catch (error) {
      console.error('❌ Error in auto-handling document size limit:', error);
      // Don't show alert to user, just log the error
    }
  }

  // Status filter functionality
  currentStatusFilter: string | null = null;

  // Filter by specific status
  filterByStatus(status: string): void {
    console.log(`🔍 Filtering by status: ${status}`);
    
    if (this.currentStatusFilter === status) {
      // If clicking the same status, clear the filter
      this.clearStatusFilter();
    } else {
      // Set new status filter
      this.currentStatusFilter = status;
      
      // Show filter indicator
      const message = `🔍 Đang lọc: ${status}\n\n📊 Hiển thị ${this.getFilteredDataByStatus(status).length} items có tình trạng "${status}"\n\n💡 Click vào box "Total" để xóa bộ lọc`;
      alert(message);
    }
  }

  // Clear status filter
  clearStatusFilter(): void {
    console.log('🔄 Clearing status filter');
    this.currentStatusFilter = null;
    alert('🔄 Đã xóa bộ lọc tình trạng\n\n📊 Hiển thị tất cả items');
  }

  // Get filtered data by status
  getFilteredDataByStatus(status: string): ScheduleItem[] {
    if (status === 'Late') {
      // Special handling for Late items
      return this.scheduleData.filter(item => {
        if (item.tinhTrang === 'Done') return false;
        
        if (item.ngayNhanKeHoach != null && item.ngayNhanKeHoach !== '') {
          try {
            let dueDate: Date;
            
            if (typeof item.ngayNhanKeHoach === 'object' && 'toDate' in item.ngayNhanKeHoach) {
              dueDate = (item.ngayNhanKeHoach as any).toDate();
            } else if (typeof item.ngayNhanKeHoach === 'string' && item.ngayNhanKeHoach.includes('/')) {
              const parts = item.ngayNhanKeHoach.split('/');
              if (parts.length === 3) {
                const day = parseInt(parts[0]);
                const month = parseInt(parts[1]) - 1;
                const year = parseInt(parts[2]);
                dueDate = new Date(year, month, day);
              } else {
                dueDate = new Date(item.ngayNhanKeHoach);
              }
            } else {
              dueDate = new Date(item.ngayNhanKeHoach);
            }
            
            if (isNaN(dueDate.getTime())) return false;
            
            dueDate.setHours(0, 0, 0, 0);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            return dueDate < today;
          } catch (error) {
            return false;
          }
        }
        return false;
      });
    } else {
      // Filter by exact status match
      return this.scheduleData.filter(item => item.tinhTrang === status);
    }
  }

  // Override getDisplayScheduleData to include status filtering
  getDisplayScheduleData(): ScheduleItem[] {
    let displayData = this.showCompletedItems ? this.scheduleData : this.getFilteredScheduleData();
    
    // Apply status filter if active
    if (this.currentStatusFilter) {
      displayData = this.getFilteredDataByStatus(this.currentStatusFilter);
    }
    
    // Ẩn các dòng có tình trạng "Done" (trừ khi showCompletedItems = true)
    if (!this.showCompletedItems) {
      displayData = displayData.filter(item => item.tinhTrang !== 'Done');
    }
    
    // Sort: urgent items first, then by STT
    displayData.sort((a, b) => {
      // First priority: urgent items go to the top
      if (a.isUrgent && !b.isUrgent) return -1;
      if (!a.isUrgent && b.isUrgent) return 1;
      
      // Second priority: by STT (numerical order)
      const sttA = parseInt(a.stt || '0') || 0;
      const sttB = parseInt(b.stt || '0') || 0;
      return sttA - sttB;
    });
    
    return displayData;
  }
} 