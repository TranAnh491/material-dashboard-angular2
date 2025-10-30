const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
const serviceAccount = require('./serviceAccountKey.json'); // Cần file service account key

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://your-project-id.firebaseio.com" // Thay bằng URL thực tế
});

const db = admin.firestore();

async function compareAndCleanupEmployees() {
  try {
    console.log('🔍 Bắt đầu so sánh và dọn dẹp mã nhân viên...\n');

    // 1. Lấy danh sách mã nhân viên từ Settings (local storage hoặc collection)
    console.log('📋 Đang lấy danh sách mã nhân viên từ Settings...');
    
    // Lấy từ collection 'user-permissions' (Settings)
    const settingsSnapshot = await db.collection('user-permissions').get();
    const settingsEmployeeIds = new Set();
    
    settingsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.employeeId) {
        settingsEmployeeIds.add(data.employeeId);
        console.log(`  ✅ Settings: ${data.employeeId} (${data.email || 'No email'})`);
      }
    });

    console.log(`\n📊 Tổng số mã nhân viên trong Settings: ${settingsEmployeeIds.size}\n`);

    // 2. Lấy danh sách mã nhân viên từ các collection khác trong Firebase
    console.log('🔍 Đang tìm mã nhân viên trong các collection Firebase...');
    
    const firebaseEmployeeIds = new Set();
    const employeeUsage = new Map(); // Track where each employee ID is used

    // Collections to check for employee IDs
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
        console.log(`  🔍 Kiểm tra collection: ${collectionName}...`);
        const snapshot = await db.collection(collectionName).get();
        
        snapshot.forEach(doc => {
          const data = doc.data();
          
          // Check various employee ID fields
          const employeeFields = ['employeeId', 'exportedBy', 'createdBy', 'checkedBy', 'performedBy', 'scannedBy'];
          
          employeeFields.forEach(field => {
            if (data[field]) {
              const empId = data[field].toString().trim();
              if (empId && empId !== 'N/A' && empId !== '') {
                firebaseEmployeeIds.add(empId);
                
                if (!employeeUsage.has(empId)) {
                  employeeUsage.set(empId, []);
                }
                employeeUsage.get(empId).push({
                  collection: collectionName,
                  docId: doc.id,
                  field: field,
                  timestamp: data.createdAt || data.updatedAt || new Date()
                });
              }
            }
          });
        });
        
        console.log(`    ✅ ${collectionName}: ${snapshot.size} documents checked`);
      } catch (error) {
        console.log(`    ⚠️ Lỗi khi kiểm tra ${collectionName}:`, error.message);
      }
    }

    console.log(`\n📊 Tổng số mã nhân viên trong Firebase: ${firebaseEmployeeIds.size}\n`);

    // 3. So sánh và tìm mã nhân viên dư thừa
    console.log('🔍 So sánh danh sách mã nhân viên...\n');
    
    const redundantEmployeeIds = new Set();
    const missingEmployeeIds = new Set();
    
    // Tìm mã nhân viên có trong Firebase nhưng không có trong Settings
    for (const empId of firebaseEmployeeIds) {
      if (!settingsEmployeeIds.has(empId)) {
        redundantEmployeeIds.add(empId);
      }
    }
    
    // Tìm mã nhân viên có trong Settings nhưng không có trong Firebase
    for (const empId of settingsEmployeeIds) {
      if (!firebaseEmployeeIds.has(empId)) {
        missingEmployeeIds.add(empId);
      }
    }

    // 4. Hiển thị kết quả
    console.log('📋 KẾT QUẢ SO SÁNH:\n');
    
    console.log(`✅ Mã nhân viên hợp lệ (có trong cả Settings và Firebase): ${settingsEmployeeIds.size - missingEmployeeIds.size}`);
    console.log(`⚠️ Mã nhân viên thiếu trong Firebase: ${missingEmployeeIds.size}`);
    console.log(`❌ Mã nhân viên dư thừa trong Firebase: ${redundantEmployeeIds.size}\n`);

    if (redundantEmployeeIds.size > 0) {
      console.log('🗑️ DANH SÁCH MÃ NHÂN VIÊN DƯ THỪA:');
      console.log('=====================================');
      
      for (const empId of redundantEmployeeIds) {
        const usage = employeeUsage.get(empId) || [];
        console.log(`\n👤 ${empId}:`);
        console.log(`   📊 Số lần sử dụng: ${usage.length}`);
        
        if (usage.length > 0) {
          console.log(`   📍 Được sử dụng trong:`);
          usage.forEach(use => {
            console.log(`      - ${use.collection}/${use.docId} (field: ${use.field})`);
          });
        }
      }
    }

    if (missingEmployeeIds.size > 0) {
      console.log('\n⚠️ DANH SÁCH MÃ NHÂN VIÊN THIẾU TRONG FIREBASE:');
      console.log('===============================================');
      for (const empId of missingEmployeeIds) {
        console.log(`   - ${empId}`);
      }
    }

    // 5. Tùy chọn xóa mã nhân viên dư thừa
    if (redundantEmployeeIds.size > 0) {
      console.log('\n🤔 BẠN CÓ MUỐN XÓA CÁC MÃ NHÂN VIÊN DƯ THỪA KHÔNG?');
      console.log('⚠️ LƯU Ý: Hành động này sẽ xóa vĩnh viễn và không thể hoàn tác!');
      console.log('\nĐể xóa, hãy chạy lệnh:');
      console.log('node compare-and-cleanup-employees.js --cleanup');
    }

    // 6. Nếu có flag --cleanup, thực hiện xóa
    if (process.argv.includes('--cleanup')) {
      console.log('\n🗑️ BẮT ĐẦU XÓA MÃ NHÂN VIÊN DƯ THỪA...\n');
      
      let deletedCount = 0;
      let errorCount = 0;
      
      for (const empId of redundantEmployeeIds) {
        try {
          console.log(`🔄 Đang xóa mã nhân viên: ${empId}...`);
          
          // Xóa từ tất cả collections
          for (const collectionName of collectionsToCheck) {
            try {
              const snapshot = await db.collection(collectionName).get();
              const batch = db.batch();
              let batchCount = 0;
              
              snapshot.forEach(doc => {
                const data = doc.data();
                const employeeFields = ['employeeId', 'exportedBy', 'createdBy', 'checkedBy', 'performedBy', 'scannedBy'];
                
                let hasEmployeeId = false;
                employeeFields.forEach(field => {
                  if (data[field] === empId) {
                    hasEmployeeId = true;
                  }
                });
                
                if (hasEmployeeId) {
                  // Update document to remove employee ID
                  const updateData = {};
                  employeeFields.forEach(field => {
                    if (data[field] === empId) {
                      updateData[field] = 'DELETED_EMPLOYEE';
                    }
                  });
                  
                  batch.update(doc.ref, updateData);
                  batchCount++;
                }
              });
              
              if (batchCount > 0) {
                await batch.commit();
                console.log(`  ✅ ${collectionName}: Cập nhật ${batchCount} documents`);
              }
            } catch (error) {
              console.log(`  ⚠️ Lỗi khi xóa từ ${collectionName}:`, error.message);
            }
          }
          
          deletedCount++;
          console.log(`✅ Đã xóa thành công: ${empId}\n`);
          
        } catch (error) {
          errorCount++;
          console.log(`❌ Lỗi khi xóa ${empId}:`, error.message);
        }
      }
      
      console.log(`\n📊 KẾT QUẢ XÓA:`);
      console.log(`✅ Thành công: ${deletedCount}`);
      console.log(`❌ Lỗi: ${errorCount}`);
    }

  } catch (error) {
    console.error('❌ Lỗi trong quá trình so sánh:', error);
  } finally {
    process.exit(0);
  }
}

// Chạy script
compareAndCleanupEmployees();
