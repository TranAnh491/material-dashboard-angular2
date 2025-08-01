// Test script cho Training Report
// Chạy trong browser console

console.log('🧪 Testing Training Report...');

// Test 1: Debug Firebase collections
async function testFirebaseCollections() {
  console.log('\n📊 Test 1: Debug Firebase Collections');
  try {
    await window.debugFirebaseService.debugAllCollections();
    console.log('✅ Test 1 passed');
  } catch (error) {
    console.error('❌ Test 1 failed:', error);
  }
}

// Test 2: Debug ASP employees
async function testASPEmployees() {
  console.log('\n👥 Test 2: Debug ASP Employees');
  try {
    await window.debugFirebaseService.debugASPEmployees();
    console.log('✅ Test 2 passed');
  } catch (error) {
    console.error('❌ Test 2 failed:', error);
  }
}

// Test 3: Create test data
async function testCreateData() {
  console.log('\n➕ Test 3: Create Test Data');
  try {
    await window.debugFirebaseService.createTestData();
    console.log('✅ Test 3 passed');
  } catch (error) {
    console.error('❌ Test 3 failed:', error);
  }
}

// Test 4: Get training reports
async function testGetReports() {
  console.log('\n📋 Test 4: Get Training Reports');
  try {
    const reports = await window.trainingReportService.getTrainingReports();
    console.log('Training reports found:', reports.length);
    console.log('Reports:', reports);
    console.log('✅ Test 4 passed');
  } catch (error) {
    console.error('❌ Test 4 failed:', error);
  }
}

// Test 5: Check authentication
async function testAuthentication() {
  console.log('\n🔐 Test 5: Check Authentication');
  try {
    const isAuth = await window.authService.isAuthenticated.toPromise();
    console.log('User authenticated:', isAuth);
    if (isAuth) {
      const user = await window.authService.currentUser.toPromise();
      console.log('Current user:', user);
    }
    console.log('✅ Test 5 passed');
  } catch (error) {
    console.error('❌ Test 5 failed:', error);
  }
}

// Run all tests
async function runAllTests() {
  console.log('🚀 Starting Training Report Tests...\n');
  
  await testAuthentication();
  await testFirebaseCollections();
  await testASPEmployees();
  await testCreateData();
  await testGetReports();
  
  console.log('\n🎉 All tests completed!');
  console.log('\n📝 Next steps:');
  console.log('1. Check if any tests failed');
  console.log('2. If no data found, create test data');
  console.log('3. Refresh the Training Report page');
  console.log('4. Check if data appears in the table');
}

// Run tests
runAllTests(); 