import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface TrainingRecord {
  id?: string; // Document ID for deletion
  employeeId: string;
  name: string;
  trainingContent: string;
  status: 'pass' | 'fail';
  trainingDate: Date;
  expiryDate: Date;
  score?: number;
  percentage?: number;
  totalQuestions?: number;
  signature?: string;
}

@Injectable({
  providedIn: 'root'
})
export class TrainingReportService {

  constructor(private firestore: AngularFirestore) {
  }

  async getTrainingReports(): Promise<TrainingRecord[]> {
    try {
      console.log('🔍 Querying Firebase for training reports...');
      
      const recordsMap = new Map<string, TrainingRecord>(); // Use Map to avoid duplicates
      let recordCount = 0;
      let aspCount = 0;
      let signatureCount = 0;

      // Query all test collections
      const collections = [
        'temperature-test-results',
        'materials-test-results', 
        'finished-goods-test-results'
      ];

      for (const collectionName of collections) {
        console.log(`📄 Querying collection: ${collectionName}`);
        
        const snapshot = await this.firestore
          .collection(collectionName)
          .ref
          .orderBy('completedAt', 'desc')
          .get();

        snapshot.forEach((doc) => {
          const data = doc.data() as any;
          recordCount++;
          
          console.log(`📄 Processing record ${recordCount}: ${data.employeeId || 'No ID'} from ${collectionName}`);
          
          // Filter only employees with ASP prefix
          if (data.employeeId && data.employeeId.startsWith('ASP')) {
            aspCount++;
            const trainingDate = data.completedAt.toDate();
            const expiryDate = new Date(trainingDate);
            expiryDate.setFullYear(expiryDate.getFullYear() + 1); // Add 1 year

            const hasSignature = !!(data.signature && data.signature.length > 0);
            if (hasSignature) signatureCount++;

            // Determine training content based on collection
            let trainingContent = 'Kiểm tra kiến thức nhiệt độ và độ ẩm';
            if (collectionName === 'materials-test-results') {
              trainingContent = 'HƯỚNG DẪN XUẤT NHẬP KHO NGUYÊN VẬT LIỆU';
            } else if (collectionName === 'finished-goods-test-results') {
              trainingContent = 'HƯỚNG DẪN XUẤT NHẬP KHO THÀNH PHẨM';
            }

            // Create unique key to avoid duplicates: employeeId + trainingContent
            const uniqueKey = `${data.employeeId}_${trainingContent}`;
            
            // Only add if not already exists, or if this record is newer
            const existingRecord = recordsMap.get(uniqueKey);
            if (!existingRecord || trainingDate > existingRecord.trainingDate) {
              console.log(`✅ ASP Employee: ${data.employeeId} - ${data.employeeName} - ${trainingContent} - Signature: ${hasSignature ? 'Yes' : 'No'}`);

              recordsMap.set(uniqueKey, {
                id: doc.id, // Store document ID for deletion
                employeeId: data.employeeId,
                name: data.employeeName,
                trainingContent: trainingContent,
                status: data.passed ? 'pass' : 'fail',
                trainingDate: trainingDate,
                expiryDate: expiryDate,
                score: data.score,
                percentage: data.percentage,
                totalQuestions: data.totalQuestions,
                signature: data.signature
              });
            } else {
              console.log(`⏭️ Skipping duplicate/older record for ${data.employeeId} - ${trainingContent}`);
            }
          }
        });
      }

      // Convert Map to Array
      const records = Array.from(recordsMap.values());

      console.log(`📊 Firebase Query Summary:`);
      console.log(`   Total records processed: ${recordCount}`);
      console.log(`   ASP employees found: ${aspCount}`);
      console.log(`   Records with signature: ${signatureCount}`);
      console.log(`   Unique records after deduplication: ${records.length}`);
      console.log(`✅ TrainingReportService: Loaded ${records.length} ASP employee records from Firebase`);
      
      return records;

    } catch (error) {
      console.error('❌ Error fetching training reports:', error);
      return [];
    }
  }

  async getTrainingReportsByEmployeeId(employeeId: string): Promise<TrainingRecord[]> {
    try {
      // Query specific employee with ASP prefix
      if (!employeeId.startsWith('ASP')) {
        return [];
      }

      const collections = [
        'temperature-test-results',
        'materials-test-results', 
        'finished-goods-test-results'
      ];

      const records: TrainingRecord[] = [];

      for (const collectionName of collections) {
        try {
          const snapshot = await this.firestore
            .collection(collectionName)
            .ref
            .where('employeeId', '==', employeeId)
            .orderBy('completedAt', 'desc')
            .get();

          snapshot.forEach((doc) => {
            const data = doc.data() as any;
            const trainingDate = data.completedAt.toDate();
            const expiryDate = new Date(trainingDate);
            expiryDate.setFullYear(expiryDate.getFullYear() + 1); // Add 1 year

            // Determine training content based on collection
            let trainingContent = 'Kiểm tra kiến thức nhiệt độ và độ ẩm';
            if (collectionName === 'materials-test-results') {
              trainingContent = 'HƯỚNG DẪN XUẤT NHẬP KHO NGUYÊN VẬT LIỆU';
            } else if (collectionName === 'finished-goods-test-results') {
              trainingContent = 'HƯỚNG DẪN XUẤT NHẬP KHO THÀNH PHẨM';
            }

            records.push({
              id: doc.id, // Store document ID for deletion
              employeeId: data.employeeId,
              name: data.employeeName,
              trainingContent: trainingContent,
              status: data.passed ? 'pass' : 'fail',
              trainingDate: trainingDate,
              expiryDate: expiryDate,
              score: data.score,
              percentage: data.percentage,
              totalQuestions: data.totalQuestions,
              signature: data.signature
            });
          });
        } catch (error) {
          console.log(`ℹ️ No records found for employee ${employeeId} in ${collectionName}`);
        }
      }

      return records;

    } catch (error) {
      console.error('Error fetching training reports for employee:', error);
      return [];
    }
  }

  async deleteTrainingRecord(recordId: string): Promise<boolean> {
    try {
      // Delete from all collections that might contain the record
      const collections = [
        'temperature-test-results',
        'materials-test-results', 
        'finished-goods-test-results'
      ];

      let deletedCount = 0;
      for (const collectionName of collections) {
        try {
          await this.firestore.collection(collectionName).doc(recordId).delete();
          deletedCount++;
          console.log(`✅ Deleted training record with ID: ${recordId} from ${collectionName}`);
        } catch (error) {
          // Record might not exist in this collection, which is fine
          console.log(`ℹ️ Record ${recordId} not found in ${collectionName}`);
        }
      }

      if (deletedCount > 0) {
        console.log(`✅ Successfully deleted training record with ID: ${recordId} from ${deletedCount} collection(s)`);
        return true;
      } else {
        console.log(`⚠️ Record ${recordId} not found in any collection`);
        return false;
      }
    } catch (error) {
      console.error('Error deleting training record:', error);
      return false;
    }
  }

  async getTrainingRecordById(recordId: string): Promise<any> {
    try {
      // Search in all collections that might contain the record
      const collections = [
        'temperature-test-results',
        'materials-test-results', 
        'finished-goods-test-results'
      ];

      for (const collectionName of collections) {
        try {
          const doc = await this.firestore.collection(collectionName).doc(recordId).get().toPromise();
          if (doc && doc.exists) {
            console.log(`✅ Found training record with ID: ${recordId} in ${collectionName}`);
            return doc.data();
          }
        } catch (error) {
          console.log(`ℹ️ Record ${recordId} not found in ${collectionName}`);
        }
      }

      console.log(`⚠️ Record ${recordId} not found in any collection`);
      return null;
    } catch (error) {
      console.error('Error getting training record by ID:', error);
      return null;
    }
  }

  async recordExists(recordId: string): Promise<boolean> {
    try {
      const collections = [
        'temperature-test-results',
        'materials-test-results', 
        'finished-goods-test-results'
      ];

      for (const collectionName of collections) {
        try {
          const doc = await this.firestore.collection(collectionName).doc(recordId).get().toPromise();
          if (doc && doc.exists) {
            return true;
          }
        } catch (error) {
          // Continue checking other collections
        }
      }

      return false;
    } catch (error) {
      console.error('Error checking if record exists:', error);
      return false;
    }
  }

  async exportTrainingReports(): Promise<string> {
    try {
      const reports = await this.getTrainingReports();
      
      let csvContent = 'Mã số nhân viên,Tên nhân viên,Nội dung đào tạo,Trạng thái,Ngày đào tạo,Ngày hết hạn\n';
      
      reports.forEach(record => {
        const row = [
          record.employeeId,
          record.name,
          record.trainingContent,
          record.status === 'pass' ? 'Đạt' : 'Không đạt',
          record.trainingDate.toLocaleDateString('vi-VN'),
          record.expiryDate.toLocaleDateString('vi-VN')
        ].join(',');
        csvContent += row + '\n';
      });

      return csvContent;

    } catch (error) {
      console.error('Error exporting training reports:', error);
      return '';
    }
  }
} 