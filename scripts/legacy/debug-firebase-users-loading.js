// Debug script để kiểm tra tại sao Firebase Users không load được
// Chạy trong browser console

console.log('🔍 Debug Firebase Users Loading...');

// 1. Kiểm tra Firebase Auth state
function checkAuthState() {
  console.log('👤 Checking auth state...');
  
  const user = firebase.auth().currentUser;
  if (!user) {
    console.error('❌ User chưa đăng nhập!');
    return false;
  }
  
  console.log('✅ User đã đăng nhập:');
  console.log('   - Email:', user.email);
  console.log('   - UID:', user.uid);
  console.log('   - Display Name:', user.displayName);
  return true;
}

// 2. Test quyền truy cập Firestore
async function testFirestoreAccess() {
  console.log('🔒 Testing Firestore access...');
  
  try {
    // Test collection users
    const usersSnapshot = await firebase.firestore().collection('users').get();
    console.log(`✅ Collection 'users': ${usersSnapshot.size} documents`);
    
    // Hiển thị 3 user đầu tiên
    let count = 0;
    usersSnapshot.forEach(doc => {
      if (count < 3) {
        const data = doc.data();
        console.log(`   📄 User ${count + 1}:`, data.email, data.displayName);
        count++;
      }
    });
    
    return usersSnapshot.size;
  } catch (error) {
    console.error('❌ Firestore access error:', error);
    console.error('   - Code:', error.code);
    console.error('   - Message:', error.message);
    return 0;
  }
}

// 3. Kiểm tra Settings component
function checkSettingsComponent() {
  console.log('🔧 Checking Settings component...');
  
  // Kiểm tra Angular component có tồn tại không
  const settingsElements = document.querySelectorAll('app-settings');
  if (settingsElements.length === 0) {
    console.error('❌ Settings component không tìm thấy!');
    return false;
  }
  
  console.log('✅ Settings component tìm thấy');
  
  // Kiểm tra Firebase Users tab
  const firebaseTab = document.querySelector('[label="Firebase Users"]');
  if (!firebaseTab) {
    console.error('❌ Firebase Users tab không tìm thấy!');
    return false;
  }
  
  console.log('✅ Firebase Users tab tìm thấy');
  return true;
}

// 4. Test manual load Firebase users
async function manualLoadFirebaseUsers() {
  console.log('🔄 Manual load Firebase users...');
  
  try {
    const currentUser = firebase.auth().currentUser;
    if (!currentUser) {
      console.error('❌ Chưa đăng nhập!');
      return;
    }
    
    // Đầu tiên, đảm bảo current user có trong Firestore
    const userRef = firebase.firestore().collection('users').doc(currentUser.uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.log('📝 Tạo current user trong Firestore...');
      await userRef.set({
        uid: currentUser.uid,
        email: currentUser.email,
        displayName: currentUser.displayName || '',
        photoURL: currentUser.photoURL || '',
        createdAt: new Date(),
        lastLoginAt: new Date()
      });
      console.log('✅ Current user đã được tạo');
    }
    
    // Load tất cả users
    const snapshot = await firebase.firestore()
      .collection('users')
      .orderBy('createdAt', 'desc')
      .get();
    
    console.log(`✅ Loaded ${snapshot.size} Firebase users:`);
    
    const users = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      users.push({
        uid: data.uid || doc.id,
        email: data.email,
        displayName: data.displayName,
        createdAt: data.createdAt ? data.createdAt.toDate() : new Date(),
        lastLoginAt: data.lastLoginAt ? data.lastLoginAt.toDate() : null
      });
      
      console.log(`   📧 ${data.email} (${data.displayName || 'No name'})`);
    });
    
    return users;
  } catch (error) {
    console.error('❌ Manual load error:', error);
    return [];
  }
}

// 5. Kiểm tra Network requests
function checkNetworkRequests() {
  console.log('🌐 Checking network requests...');
  
  // Monitor Firestore requests
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    if (args[0].includes('firestore')) {
      console.log('📡 Firestore request:', args[0]);
    }
    return originalFetch.apply(this, args);
  };
  
  console.log('✅ Network monitoring enabled');
}

// 6. Fix Firebase Users
async function fixFirebaseUsers() {
  console.log('🔧 Attempting to fix Firebase Users...');
  
  try {
    // Reload current user vào Firestore
    const currentUser = firebase.auth().currentUser;
    if (currentUser) {
      await firebase.firestore().collection('users').doc(currentUser.uid).set({
        uid: currentUser.uid,
        email: currentUser.email,
        displayName: currentUser.displayName || '',
        photoURL: currentUser.photoURL || '',
        createdAt: new Date(),
        lastLoginAt: new Date()
      }, { merge: true });
      
      console.log('✅ Current user synced to Firestore');
    }
    
    // Trigger refresh Settings page
    console.log('🔄 Refreshing Settings page...');
    window.location.reload();
    
  } catch (error) {
    console.error('❌ Fix error:', error);
  }
}

// 7. Comprehensive debug
async function comprehensiveDebug() {
  console.log('🚀 Starting comprehensive debug...\n');
  
  // Step 1: Check auth
  const authOK = checkAuthState();
  if (!authOK) return;
  
  // Step 2: Test Firestore
  console.log('\n📊 Testing Firestore...');
  const userCount = await testFirestoreAccess();
  
  // Step 3: Check component
  console.log('\n🔧 Checking component...');
  const componentOK = checkSettingsComponent();
  
  // Step 4: Manual load
  console.log('\n🔄 Manual load test...');
  const users = await manualLoadFirebaseUsers();
  
  // Summary
  console.log('\n📋 SUMMARY:');
  console.log(`   - Auth: ${authOK ? '✅' : '❌'}`);
  console.log(`   - Firestore: ${userCount > 0 ? '✅' : '❌'} (${userCount} users)`);
  console.log(`   - Component: ${componentOK ? '✅' : '❌'}`);
  console.log(`   - Manual Load: ${users.length > 0 ? '✅' : '❌'} (${users.length} users)`);
  
  if (users.length === 0) {
    console.log('\n🔧 Suggested fixes:');
    console.log('   1. Update Firestore Rules');
    console.log('   2. Ensure user is logged in');
    console.log('   3. Run fixFirebaseUsers()');
  }
}

// Commands
console.log('📋 Available commands:');
console.log('- comprehensiveDebug() - Full debug');
console.log('- checkAuthState() - Check login status');
console.log('- testFirestoreAccess() - Test Firestore access');
console.log('- manualLoadFirebaseUsers() - Manual load users');
console.log('- fixFirebaseUsers() - Try to fix the issue');

// Auto run
comprehensiveDebug(); 