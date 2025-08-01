// Script migrate dữ liệu Local Users
// Chạy trong browser console

console.log('🚀 Bắt đầu migrate Local Users data...');

// 1. Kiểm tra dữ liệu cũ trong user-permissions
async function checkOldData() {
  try {
    console.log('🔍 Kiểm tra dữ liệu cũ trong user-permissions...');
    
    const snapshot = await firebase.firestore()
      .collection('user-permissions')
      .where('employeeId', '!=', null) // Lọc dữ liệu có employeeId (local users)
      .get();
    
    console.log(`📊 Tìm thấy ${snapshot.size} local users trong user-permissions`);
    
    const localUsers = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.employeeId) { // Chỉ lấy local users
        localUsers.push({
          id: doc.id,
          ...data
        });
        console.log(`👤 Local User: ${data.employeeId}`);
      }
    });
    
    return localUsers;
  } catch (error) {
    console.error('❌ Lỗi khi kiểm tra dữ liệu cũ:', error);
    return [];
  }
}

// 2. Migrate dữ liệu sang local-user-permissions
async function migrateLocalUsers(localUsers) {
  if (localUsers.length === 0) {
    console.log('📭 Không có dữ liệu local users để migrate');
    return;
  }
  
  try {
    console.log(`🔄 Migrate ${localUsers.length} local users...`);
    
    const batch = firebase.firestore().batch();
    
    for (const user of localUsers) {
      // Tạo document mới trong local-user-permissions
      const newDocRef = firebase.firestore()
        .collection('local-user-permissions')
        .doc();
      
      const userData = {
        employeeId: user.employeeId,
        password: user.password,
        hasDeletePermission: user.hasDeletePermission || false,
        createdAt: user.createdAt || new Date(),
        updatedAt: user.updatedAt || new Date()
      };
      
      batch.set(newDocRef, userData);
      console.log(`📝 Sẽ migrate: ${user.employeeId}`);
    }
    
    await batch.commit();
    console.log('✅ Migrate thành công!');
    
    return localUsers.length;
  } catch (error) {
    console.error('❌ Lỗi khi migrate:', error);
    return 0;
  }
}

// 3. Kiểm tra dữ liệu mới
async function checkNewData() {
  try {
    console.log('🔍 Kiểm tra dữ liệu mới trong local-user-permissions...');
    
    const snapshot = await firebase.firestore()
      .collection('local-user-permissions')
      .get();
    
    console.log(`📊 Collection local-user-permissions có ${snapshot.size} documents`);
    
    snapshot.forEach(doc => {
      const data = doc.data();
      console.log(`✅ ${data.employeeId} - Quyền xóa: ${data.hasDeletePermission}`);
    });
    
    return snapshot.size;
  } catch (error) {
    console.error('❌ Lỗi khi kiểm tra dữ liệu mới:', error);
    return 0;
  }
}

// 4. Xóa dữ liệu cũ (chỉ local users)
async function cleanupOldData(localUsers) {
  if (localUsers.length === 0) {
    console.log('📭 Không có dữ liệu cũ để xóa');
    return;
  }
  
  try {
    console.log(`🗑️ Xóa ${localUsers.length} local users từ user-permissions...`);
    
    const batch = firebase.firestore().batch();
    
    for (const user of localUsers) {
      const docRef = firebase.firestore()
        .collection('user-permissions')
        .doc(user.id);
      
      batch.delete(docRef);
      console.log(`🗑️ Sẽ xóa: ${user.employeeId} (${user.id})`);
    }
    
    await batch.commit();
    console.log('✅ Cleanup thành công!');
  } catch (error) {
    console.error('❌ Lỗi khi cleanup:', error);
  }
}

// 5. Tạo test data nếu không có
async function createTestLocalUsers() {
  try {
    console.log('🧪 Tạo test local users...');
    
    const testUsers = [
      {
        employeeId: 'EMP001',
        password: 'password123',
        hasDeletePermission: true
      },
      {
        employeeId: 'EMP002', 
        password: 'password456',
        hasDeletePermission: false
      },
      {
        employeeId: 'Admin',
        password: 'Admin',
        hasDeletePermission: true
      }
    ];
    
    const batch = firebase.firestore().batch();
    
    for (const user of testUsers) {
      const docRef = firebase.firestore()
        .collection('local-user-permissions')
        .doc();
      
      batch.set(docRef, {
        ...user,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      console.log(`📝 Tạo test user: ${user.employeeId}`);
    }
    
    await batch.commit();
    console.log('✅ Tạo test data thành công!');
  } catch (error) {
    console.error('❌ Lỗi khi tạo test data:', error);
  }
}

// 6. Main function
async function migrateLocalUsersData() {
  console.log('🚀 Bắt đầu migrate Local Users data...\n');
  
  // Kiểm tra Firebase connection
  if (typeof firebase === 'undefined') {
    console.error('❌ Firebase chưa được load!');
    return;
  }
  
  // Kiểm tra user đã đăng nhập
  const currentUser = firebase.auth().currentUser;
  if (!currentUser) {
    console.error('❌ Vui lòng đăng nhập trước khi migrate!');
    return;
  }
  
  try {
    // Bước 1: Kiểm tra dữ liệu cũ
    const localUsers = await checkOldData();
    
    // Bước 2: Migrate dữ liệu
    if (localUsers.length > 0) {
      await migrateLocalUsers(localUsers);
      
      // Bước 3: Kiểm tra dữ liệu mới
      await checkNewData();
      
      // Bước 4: Xóa dữ liệu cũ (optional - chỉ chạy khi chắc chắn)
      // await cleanupOldData(localUsers);
    } else {
      console.log('📭 Không tìm thấy dữ liệu local users cũ');
      
      // Tạo test data
      const newDataCount = await checkNewData();
      if (newDataCount === 0) {
        console.log('🧪 Tạo test local users...');
        await createTestLocalUsers();
        await checkNewData();
      }
    }
    
    console.log('\n✅ Migration hoàn thành!');
    console.log('🔄 Bây giờ hãy refresh trang Settings');
    
  } catch (error) {
    console.error('❌ Lỗi trong quá trình migrate:', error);
  }
}

// 7. Các function helper
async function justCheckData() {
  console.log('🔍 Kiểm tra dữ liệu hiện tại...\n');
  
  console.log('--- OLD DATA (user-permissions) ---');
  await checkOldData();
  
  console.log('\n--- NEW DATA (local-user-permissions) ---');
  await checkNewData();
}

function reloadSettings() {
  console.log('🔄 Reloading Settings...');
  window.location.reload();
}

// Commands
console.log('📋 Các lệnh có sẵn:');
console.log('- migrateLocalUsersData() - Migrate toàn bộ dữ liệu');
console.log('- justCheckData() - Chỉ kiểm tra dữ liệu');
console.log('- createTestLocalUsers() - Tạo test data');
console.log('- reloadSettings() - Reload trang');

// Tự động chạy
migrateLocalUsersData(); 