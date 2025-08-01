import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { TrainingRecord } from './training-report.service';

@Injectable({
  providedIn: 'root'
})
export class TrainingReportDebugService {

  constructor(private firestore: AngularFirestore) { }

  // Debug chi tiết từng collection
  async debugCollectionDetails(): Promise<void> {
    console.log('🔍 Debugging collection details...');
    
    const collections = [
      'temperature-test-results',
      'materials-test-results', 
      'finished-goods-test-results'
    ];

    for (const collectionName of collections) {
      try {
        console.log(`\n📄 === ${collectionName} ===`);
        
        const snapshot = await this.firestore
          .collection(collectionName)
          .ref
          .get();

        console.log(`   Total documents: ${snapshot.size}`);
        
        if (snapshot.size > 0) {
          console.log(`   Document details:`);
          snapshot.forEach((doc) => {
            const data = doc.data() as any;
            const index = 0; // We'll just show all documents
            console.log(`     ${index + 1}. ID: ${doc.id}`);
            console.log(`        Employee ID: ${data.employeeId || 'N/A'}`);
            console.log(`        Employee Name: ${data.employeeName || 'N/A'}`);
            console.log(`        Passed: ${data.passed || 'N/A'}`);
            console.log(`        Score: ${data.score || 'N/A'}`);
            console.log(`        Percentage: ${data.percentage || 'N/A'}`);
            console.log(`        Total Questions: ${data.totalQuestions || 'N/A'}`);
            console.log(`        Completed At: ${data.completedAt ? data.completedAt.toDate() : 'N/A'}`);
            console.log(`        Has Signature: ${data.signature ? 'Yes' : 'No'}`);
            console.log(`        Is ASP Employee: ${data.employeeId && data.employeeId.startsWith('ASP') ? 'YES' : 'NO'}`);
            console.log(`        ---`);
          });
        } else {
          console.log(`   ⚠️ No documents found`);
        }
        
      } catch (error) {
        console.error(`❌ Error checking ${collectionName}:`, error);
      }
    }
  }

  // Kiểm tra xem có dữ liệu nào không phải ASP không
  async checkNonASPData(): Promise<void> {
    console.log('🔍 Checking for non-ASP data...');
    
    const collections = [
      'temperature-test-results',
      'materials-test-results', 
      'finished-goods-test-results'
    ];

    let totalNonASP = 0;
    const nonASPEmployees = new Set<string>();

    for (const collectionName of collections) {
      try {
        console.log(`\n📄 Checking non-ASP employees in: ${collectionName}`);
        
        const snapshot = await this.firestore
          .collection(collectionName)
          .ref
          .get();

        let nonASPCount = 0;
        snapshot.forEach((doc) => {
          const data = doc.data() as any;
          if (data.employeeId && !data.employeeId.startsWith('ASP')) {
            nonASPCount++;
            nonASPEmployees.add(data.employeeId);
            console.log(`   ⚠️ Non-ASP Employee: ${data.employeeId} - ${data.employeeName || 'No name'}`);
          }
        });
        
        console.log(`   Non-ASP employees in ${collectionName}: ${nonASPCount}`);
        totalNonASP += nonASPCount;
        
      } catch (error) {
        console.error(`❌ Error checking non-ASP employees in ${collectionName}:`, error);
      }
    }

    console.log(`\n📊 Non-ASP Summary:`);
    console.log(`   Total non-ASP employees found: ${totalNonASP}`);
    console.log(`   Unique non-ASP employee IDs: ${nonASPEmployees.size}`);
    if (nonASPEmployees.size > 0) {
      console.log(`   Non-ASP Employee IDs: ${Array.from(nonASPEmployees).join(', ')}`);
      console.log(`   💡 Suggestion: Convert these to ASP format or create new ASP records`);
    }
  }

  // Tạo dữ liệu ASP từ dữ liệu cũ
  async convertToASPFormat(): Promise<void> {
    console.log('🔄 Converting existing data to ASP format...');
    
    const collections = [
      'temperature-test-results',
      'materials-test-results', 
      'finished-goods-test-results'
    ];

    let convertedCount = 0;

    for (const collectionName of collections) {
      try {
        console.log(`\n📄 Converting data in: ${collectionName}`);
        
        const snapshot = await this.firestore
          .collection(collectionName)
          .ref
          .get();

        snapshot.forEach(async (doc) => {
          const data = doc.data() as any;
          if (data.employeeId && !data.employeeId.startsWith('ASP')) {
            try {
              // Create new document with ASP prefix
              const newEmployeeId = `ASP${data.employeeId}`;
              const newData = {
                ...data,
                employeeId: newEmployeeId,
                originalEmployeeId: data.employeeId, // Keep original for reference
                convertedAt: new Date()
              };

              await this.firestore.collection(collectionName).add(newData);
              console.log(`   ✅ Converted ${data.employeeId} → ${newEmployeeId}`);
              convertedCount++;
            } catch (error) {
              console.error(`   ❌ Failed to convert ${data.employeeId}:`, error);
            }
          }
        });
        
      } catch (error) {
        console.error(`❌ Error converting data in ${collectionName}:`, error);
      }
    }

    console.log(`\n📊 Conversion Summary:`);
    console.log(`   Total records converted: ${convertedCount}`);
    if (convertedCount > 0) {
      console.log(`   💡 Please refresh the Training Report page to see the new ASP data`);
    }
  }

  // Kiểm tra Firestore Rules
  async testFirestoreAccess(): Promise<void> {
    console.log('🔐 Testing Firestore access...');
    
    const collections = [
      'temperature-test-results',
      'materials-test-results', 
      'finished-goods-test-results'
    ];

    for (const collectionName of collections) {
      try {
        console.log(`\n📄 Testing access to: ${collectionName}`);
        
        // Test read access
        const snapshot = await this.firestore
          .collection(collectionName)
          .ref
          .limit(1)
          .get();

        console.log(`   ✅ Read access: OK (${snapshot.size} documents found)`);
        
        // Test write access (create a test document)
        const testDoc = {
          testField: 'test',
          timestamp: new Date()
        };
        
        const docRef = await this.firestore.collection(collectionName).add(testDoc);
        console.log(`   ✅ Write access: OK (created test document: ${docRef.id})`);
        
        // Clean up test document
        await docRef.delete();
        console.log(`   ✅ Delete access: OK (cleaned up test document)`);
        
      } catch (error) {
        console.error(`❌ Access test failed for ${collectionName}:`, error);
        console.error(`   Error details:`, error.message);
      }
    }
  }

  // Tạo dữ liệu test ASP
  async createASPTestData(): Promise<void> {
    console.log('🧪 Creating ASP test data...');
    
    const testData = [
      {
        employeeId: 'ASP001',
        employeeName: 'Nguyễn Văn A',
        passed: true,
        score: 85,
        percentage: 85,
        totalQuestions: 10,
        completedAt: new Date(),
        signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
      },
      {
        employeeId: 'ASP002',
        employeeName: 'Trần Thị B',
        passed: false,
        score: 60,
        percentage: 60,
        totalQuestions: 10,
        completedAt: new Date(),
        signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
      },
      {
        employeeId: 'ASP003',
        employeeName: 'Lê Văn C',
        passed: true,
        score: 90,
        percentage: 90,
        totalQuestions: 10,
        completedAt: new Date(),
        signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
      }
    ];

    try {
      // Add to all collections
      for (const collectionName of ['temperature-test-results', 'materials-test-results', 'finished-goods-test-results']) {
        for (const data of testData) {
          await this.firestore.collection(collectionName).add(data);
          console.log(`✅ Added test data for ${data.employeeId} to ${collectionName}`);
        }
      }
      
      console.log('✅ ASP test data created successfully');
    } catch (error) {
      console.error('❌ Error creating ASP test data:', error);
    }
  }
} 