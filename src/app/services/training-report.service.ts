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
      
      // Query the temperature-test-results collection, ordered by completedAt desc
      const snapshot = await this.firestore
        .collection('temperature-test-results')
        .ref
        .orderBy('completedAt', 'desc')
        .get();

      const records: TrainingRecord[] = [];
      let recordCount = 0;
      let aspCount = 0;
      let signatureCount = 0;

      snapshot.forEach((doc) => {
        const data = doc.data() as any;
        recordCount++;
        
        console.log(`📄 Processing record ${recordCount}: ${data.employeeId || 'No ID'}`);
        
        // Filter only employees with ASP prefix
        if (data.employeeId && data.employeeId.startsWith('ASP')) {
          aspCount++;
          const trainingDate = data.completedAt.toDate();
          const expiryDate = new Date(trainingDate);
          expiryDate.setFullYear(expiryDate.getFullYear() + 1); // Add 1 year

          const hasSignature = !!(data.signature && data.signature.length > 0);
          if (hasSignature) signatureCount++;

          console.log(`✅ ASP Employee: ${data.employeeId} - ${data.employeeName} - Signature: ${hasSignature ? 'Yes' : 'No'}`);

          records.push({
            id: doc.id, // Store document ID for deletion
            employeeId: data.employeeId,
            name: data.employeeName,
            trainingContent: data.testTitle || 'Kiểm tra kiến thức nhiệt độ và độ ẩm',
            status: data.passed ? 'pass' : 'fail',
            trainingDate: trainingDate,
            expiryDate: expiryDate,
            score: data.score,
            percentage: data.percentage,
            totalQuestions: data.totalQuestions,
            signature: data.signature
          });
        }
      });

      console.log(`📊 Firebase Query Summary:`);
      console.log(`   Total records processed: ${recordCount}`);
      console.log(`   ASP employees found: ${aspCount}`);
      console.log(`   Records with signature: ${signatureCount}`);
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

      const snapshot = await this.firestore
        .collection('temperature-test-results')
        .ref
        .where('employeeId', '==', employeeId)
        .orderBy('completedAt', 'desc')
        .get();

      const records: TrainingRecord[] = [];

      snapshot.forEach((doc) => {
        const data = doc.data() as any;
        const trainingDate = data.completedAt.toDate();
        const expiryDate = new Date(trainingDate);
        expiryDate.setFullYear(expiryDate.getFullYear() + 1); // Add 1 year

        records.push({
          id: doc.id, // Store document ID for deletion
          employeeId: data.employeeId,
          name: data.employeeName,
          trainingContent: data.testTitle || 'Kiểm tra kiến thức nhiệt độ và độ ẩm',
          status: data.passed ? 'pass' : 'fail',
          trainingDate: trainingDate,
          expiryDate: expiryDate,
          score: data.score,
          percentage: data.percentage,
          totalQuestions: data.totalQuestions,
          signature: data.signature
        });
      });

      return records;

    } catch (error) {
      console.error('Error fetching training reports for employee:', error);
      return [];
    }
  }

  async deleteTrainingRecord(recordId: string): Promise<boolean> {
    try {
      await this.firestore.collection('temperature-test-results').doc(recordId).delete();
      console.log(`✅ Deleted training record with ID: ${recordId}`);
      return true;
    } catch (error) {
      console.error('Error deleting training record:', error);
      return false;
    }
  }

  async getTrainingRecordById(recordId: string): Promise<any> {
    try {
      const doc = await this.firestore.collection('temperature-test-results').doc(recordId).get().toPromise();
      if (doc && doc.exists) {
        return doc.data();
      }
      return null;
    } catch (error) {
      console.error('Error getting training record by ID:', error);
      return null;
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