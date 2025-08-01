import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';

@Injectable({
  providedIn: 'root'
})
export class DebugFirebaseService {

  constructor(private firestore: AngularFirestore) { }

  async debugAllCollections(): Promise<void> {
    console.log('🔍 Debugging all Firebase collections...');
    
    const collections = [
      'temperature-test-results',
      'materials-test-results', 
      'finished-goods-test-results'
    ];

    for (const collectionName of collections) {
      try {
        console.log(`\n📄 Checking collection: ${collectionName}`);
        
        const snapshot = await this.firestore
          .collection(collectionName)
          .ref
          .get();

        console.log(`   Total documents: ${snapshot.size}`);
        
        if (snapshot.size > 0) {
          console.log(`   Sample documents:`);
          snapshot.forEach((doc) => {
            const data = doc.data() as any;
            const index = 0; // We'll just show all documents for now
            console.log(`     ${index + 1}. ID: ${doc.id}`);
            console.log(`        Employee ID: ${data.employeeId || 'N/A'}`);
            console.log(`        Employee Name: ${data.employeeName || 'N/A'}`);
            console.log(`        Passed: ${data.passed || 'N/A'}`);
            console.log(`        Score: ${data.score || 'N/A'}`);
            console.log(`        Completed At: ${data.completedAt ? data.completedAt.toDate() : 'N/A'}`);
            console.log(`        Has Signature: ${data.signature ? 'Yes' : 'No'}`);
          });
          
          if (snapshot.size > 3) {
            console.log(`     ... and ${snapshot.size - 3} more documents`);
          }
        } else {
          console.log(`   ⚠️ No documents found in ${collectionName}`);
        }
        
      } catch (error) {
        console.error(`❌ Error checking ${collectionName}:`, error);
      }
    }
  }

  async debugAllEmployees(): Promise<void> {
    console.log('🔍 Debugging ALL employees (not just ASP)...');
    
    const collections = [
      'temperature-test-results',
      'materials-test-results', 
      'finished-goods-test-results'
    ];

    let totalEmployees = 0;
    const allEmployees = new Set<string>();
    const employeeTypes = new Map<string, number>();

    for (const collectionName of collections) {
      try {
        console.log(`\n📄 Checking ALL employees in: ${collectionName}`);
        
        const snapshot = await this.firestore
          .collection(collectionName)
          .ref
          .get();

        let employeeCount = 0;
        snapshot.forEach((doc) => {
          const data = doc.data() as any;
          if (data.employeeId) {
            employeeCount++;
            allEmployees.add(data.employeeId);
            
            // Count by employee ID prefix
            const prefix = data.employeeId.substring(0, 3);
            employeeTypes.set(prefix, (employeeTypes.get(prefix) || 0) + 1);
            
            console.log(`   ✅ Employee: ${data.employeeId} - ${data.employeeName || 'No name'} - Collection: ${collectionName}`);
          }
        });
        
        console.log(`   Total employees in ${collectionName}: ${employeeCount}`);
        totalEmployees += employeeCount;
        
      } catch (error) {
        console.error(`❌ Error checking employees in ${collectionName}:`, error);
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Total employees found: ${totalEmployees}`);
    console.log(`   Unique employee IDs: ${allEmployees.size}`);
    console.log(`   Employee ID types:`);
    employeeTypes.forEach((count, prefix) => {
      console.log(`     ${prefix}*: ${count} employees`);
    });
    console.log(`   All Employee IDs: ${Array.from(allEmployees).join(', ')}`);
  }

  async debugASPEmployees(): Promise<void> {
    console.log('🔍 Debugging ASP employees specifically...');
    
    const collections = [
      'temperature-test-results',
      'materials-test-results', 
      'finished-goods-test-results'
    ];

    let totalASPEmployees = 0;
    const aspEmployees = new Set<string>();

    for (const collectionName of collections) {
      try {
        console.log(`\n📄 Checking ASP employees in: ${collectionName}`);
        
        const snapshot = await this.firestore
          .collection(collectionName)
          .ref
          .get();

        let aspCount = 0;
        snapshot.forEach((doc) => {
          const data = doc.data() as any;
          if (data.employeeId && data.employeeId.startsWith('ASP')) {
            aspCount++;
            aspEmployees.add(data.employeeId);
            console.log(`   ✅ ASP Employee: ${data.employeeId} - ${data.employeeName || 'No name'}`);
          }
        });
        
        console.log(`   ASP employees in ${collectionName}: ${aspCount}`);
        totalASPEmployees += aspCount;
        
      } catch (error) {
        console.error(`❌ Error checking ASP employees in ${collectionName}:`, error);
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Total ASP employees found: ${totalASPEmployees}`);
    console.log(`   Unique ASP employee IDs: ${aspEmployees.size}`);
    console.log(`   ASP Employee IDs: ${Array.from(aspEmployees).join(', ')}`);
  }

  async createTestData(): Promise<void> {
    console.log('🧪 Creating test data...');
    
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
      }
    ];

    try {
      // Add to temperature-test-results
      for (const data of testData) {
        await this.firestore.collection('temperature-test-results').add(data);
        console.log(`✅ Added test data for ${data.employeeId}`);
      }
      
      console.log('✅ Test data created successfully');
    } catch (error) {
      console.error('❌ Error creating test data:', error);
    }
  }

  async clearTestData(): Promise<void> {
    console.log('🧹 Clearing test data...');
    
    const collections = [
      'temperature-test-results',
      'materials-test-results', 
      'finished-goods-test-results'
    ];

    for (const collectionName of collections) {
      try {
        const snapshot = await this.firestore
          .collection(collectionName)
          .ref
          .where('employeeId', 'in', ['ASP001', 'ASP002'])
          .get();

        const batch = this.firestore.firestore.batch();
        snapshot.forEach((doc) => {
          batch.delete(doc.ref);
        });

        await batch.commit();
        console.log(`✅ Cleared test data from ${collectionName}`);
        
      } catch (error) {
        console.error(`❌ Error clearing test data from ${collectionName}:`, error);
      }
    }
  }

  // New method to get ALL training reports (not just ASP)
  async getAllTrainingReports(): Promise<any[]> {
    console.log('🔍 Getting ALL training reports (not just ASP)...');
    
    const collections = [
      'temperature-test-results',
      'materials-test-results', 
      'finished-goods-test-results'
    ];

    const allRecords: any[] = [];

    for (const collectionName of collections) {
      try {
        console.log(`📄 Getting records from: ${collectionName}`);
        
        const snapshot = await this.firestore
          .collection(collectionName)
          .ref
          .orderBy('completedAt', 'desc')
          .get();

        console.log(`   Found ${snapshot.size} records in ${collectionName}`);
        
        snapshot.forEach((doc) => {
          const data = doc.data() as any;
          allRecords.push({
            id: doc.id,
            collection: collectionName,
            employeeId: data.employeeId,
            employeeName: data.employeeName,
            passed: data.passed,
            score: data.score,
            percentage: data.percentage,
            completedAt: data.completedAt ? data.completedAt.toDate() : null,
            signature: data.signature
          });
        });
        
      } catch (error) {
        console.error(`❌ Error getting records from ${collectionName}:`, error);
      }
    }

    console.log(`📊 Total records found: ${allRecords.length}`);
    console.log('All records:', allRecords);
    
    return allRecords;
  }
} 