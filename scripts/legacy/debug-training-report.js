// Debug script cho Training Report
// Chạy trong browser console

console.log('🔍 Debugging Training Report Issues...');

// Test 1: Debug tất cả collections
async function debugAllCollections() {
  console.log('\n📊 Test 1: Debug All Collections');
  try {
    await window.debugFirebaseService.debugAllCollections();
    console.log('✅ Test 1 completed');
  } catch (error) {
    console.error('❌ Test 1 failed:', error);
  }
}

// Test 2: Debug ASP employees
async function debugASPEmployees() {
  console.log('\n👥 Test 2: Debug ASP Employees');
  try {
    await window.debugFirebaseService.debugASPEmployees();
    console.log('✅ Test 2 completed');
  } catch (error) {
    console.error('❌ Test 2 failed:', error);
  }
}

// Test 3: Debug collection details
async function debugCollectionDetails() {
  console.log('\n🔍 Test 3: Debug Collection Details');
  try {
    await window.trainingReportDebugService.debugCollectionDetails();
    console.log('✅ Test 3 completed');
  } catch (error) {
    console.error('❌ Test 3 failed:', error);
  }
}

// Test 4: Check non-ASP data
async function checkNonASPData() {
  console.log('\n⚠️ Test 4: Check Non-ASP Data');
  try {
    await window.trainingReportDebugService.checkNonASPData();
    console.log('✅ Test 4 completed');
  } catch (error) {
    console.error('❌ Test 4 failed:', error);
  }
}

// Test 5: Test Firestore access
async function testFirestoreAccess() {
  console.log('\n🔐 Test 5: Test Firestore Access');
  try {
    await window.trainingReportDebugService.testFirestoreAccess();
    console.log('✅ Test 5 completed');
  } catch (error) {
    console.error('❌ Test 5 failed:', error);
  }
}

// Test 6: Get training reports
async function getTrainingReports() {
  console.log('\n📋 Test 6: Get Training Reports');
  try {
    const reports = await window.trainingReportService.getTrainingReports();
    console.log('Training reports found:', reports.length);
    console.log('Reports:', reports);
    console.log('✅ Test 6 completed');
  } catch (error) {
    console.error('❌ Test 6 failed:', error);
  }
}

// Test 7: Convert non-ASP to ASP format
async function convertToASP() {
  console.log('\n🔄 Test 7: Convert to ASP Format');
  try {
    await window.trainingReportDebugService.convertToASPFormat();
    console.log('✅ Test 7 completed');
  } catch (error) {
    console.error('❌ Test 7 failed:', error);
  }
}

// Test 8: Create ASP test data
async function createASPTestData() {
  console.log('\n🧪 Test 8: Create ASP Test Data');
  try {
    await window.trainingReportDebugService.createASPTestData();
    console.log('✅ Test 8 completed');
  } catch (error) {
    console.error('❌ Test 8 failed:', error);
  }
}

// Run comprehensive debug
async function runComprehensiveDebug() {
  console.log('🚀 Starting Comprehensive Training Report Debug...\n');
  
  await debugAllCollections();
  await debugASPEmployees();
  await debugCollectionDetails();
  await checkNonASPData();
  await testFirestoreAccess();
  await getTrainingReports();
  
  console.log('\n📝 Analysis:');
  console.log('1. Check if collections exist and have data');
  console.log('2. Check if there are non-ASP employees that need conversion');
  console.log('3. Check if Firestore access is working');
  console.log('4. Check if training reports are being retrieved');
  
  console.log('\n💡 Next Steps:');
  console.log('- If no ASP data found: Run convertToASP() or createASPTestData()');
  console.log('- If access denied: Check Firestore Rules');
  console.log('- If data exists but not showing: Check service logic');
}

// Quick fix functions
async function quickFix() {
  console.log('🔧 Running Quick Fix...');
  
  // Check if we have any data first
  await debugAllCollections();
  
  // If no ASP data, create some
  await createASPTestData();
  
  // Convert any existing non-ASP data
  await convertToASP();
  
  console.log('✅ Quick fix completed. Please refresh the Training Report page.');
}

// Run debug
runComprehensiveDebug();

// Export functions for manual use
window.debugTrainingReport = {
  debugAllCollections,
  debugASPEmployees,
  debugCollectionDetails,
  checkNonASPData,
  testFirestoreAccess,
  getTrainingReports,
  convertToASP,
  createASPTestData,
  quickFix,
  runComprehensiveDebug
}; 