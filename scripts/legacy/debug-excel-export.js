// Script debug để test xuất Excel
// Chạy trong console browser

function testExcelExport() {
  console.log('🔍 Testing Excel export...');
  
  // Kiểm tra XLSX library
  console.log('window.XLSX:', window.XLSX);
  console.log('typeof XLSX:', typeof window.XLSX);
  
  if (!window.XLSX) {
    console.error('❌ XLSX library not found');
    return;
  }
  
  // Tạo dữ liệu test
  const testData = [
    { 'STT': 'STT', 'Mã nhân viên Settings': 'Mã nhân viên Settings', 'Mã nhân viên Firebase': 'Mã nhân viên Firebase', 'Trạng thái': 'Trạng thái', 'Ghi chú': 'Ghi chú' },
    { 'STT': 1, 'Mã nhân viên Settings': 'ASP0001', 'Mã nhân viên Firebase': '', 'Trạng thái': 'Thiếu', 'Ghi chú': 'Test data' },
    { 'STT': 2, 'Mã nhân viên Settings': '', 'Mã nhân viên Firebase': 'ASP0002', 'Trạng thái': 'Dư thừa', 'Ghi chú': 'Test data' }
  ];
  
  try {
    // Tạo workbook
    const wb = window.XLSX.utils.book_new();
    
    // Tạo worksheet
    const ws = window.XLSX.utils.json_to_sheet(testData);
    
    // Thêm worksheet vào workbook
    window.XLSX.utils.book_append_sheet(wb, ws, 'Test');
    
    // Xuất file
    const filename = `Test_Excel_${new Date().toISOString().split('T')[0]}.xlsx`;
    window.XLSX.writeFile(wb, filename);
    
    console.log('✅ Excel export test successful:', filename);
    alert('✅ Test Excel export successful!');
    
  } catch (error) {
    console.error('❌ Excel export test failed:', error);
    alert('❌ Excel export test failed: ' + error.message);
  }
}

// Chạy test
testExcelExport();
