/**
 * Script đơn giản để so sánh và dọn dẹp mã nhân viên
 * Chạy từ browser console trong tab Settings
 */

// Hàm để so sánh mã nhân viên
async function compareEmployees() {
  console.log('🔍 Bắt đầu so sánh mã nhân viên...');
  
  try {
    // Lấy component settings từ window
    const settingsComponent = window.settingsComponent;
    if (!settingsComponent) {
      console.error('❌ Không tìm thấy settings component. Vui lòng chạy từ tab Settings.');
      return;
    }
    
    // Gọi method so sánh
    await settingsComponent.compareEmployees();
    
    console.log('✅ Hoàn thành so sánh mã nhân viên!');
    console.log('📊 Kết quả:', settingsComponent.employeeComparisonResult);
    
  } catch (error) {
    console.error('❌ Lỗi khi so sánh:', error);
  }
}

// Hàm để xóa tất cả mã nhân viên dư thừa
async function cleanupAllRedundant() {
  console.log('🗑️ Bắt đầu xóa tất cả mã nhân viên dư thừa...');
  
  try {
    const settingsComponent = window.settingsComponent;
    if (!settingsComponent) {
      console.error('❌ Không tìm thấy settings component. Vui lòng chạy từ tab Settings.');
      return;
    }
    
    if (!settingsComponent.employeeComparisonResult) {
      console.log('⚠️ Chưa có kết quả so sánh. Đang chạy so sánh trước...');
      await compareEmployees();
    }
    
    // Xóa tất cả mã nhân viên dư thừa
    await settingsComponent.cleanupAllRedundantEmployees();
    
    console.log('✅ Hoàn thành xóa mã nhân viên dư thừa!');
    
  } catch (error) {
    console.error('❌ Lỗi khi xóa:', error);
  }
}

// Hàm để xuất báo cáo
function exportReport() {
  try {
    const settingsComponent = window.settingsComponent;
    if (!settingsComponent) {
      console.error('❌ Không tìm thấy settings component. Vui lòng chạy từ tab Settings.');
      return;
    }
    
    if (!settingsComponent.employeeComparisonResult) {
      console.log('⚠️ Chưa có kết quả so sánh. Vui lòng chạy so sánh trước.');
      return;
    }
    
    settingsComponent.exportComparisonReport();
    console.log('✅ Đã xuất báo cáo!');
    
  } catch (error) {
    console.error('❌ Lỗi khi xuất báo cáo:', error);
  }
}

// Hàm hiển thị hướng dẫn
function showHelp() {
  console.log(`
🔧 HƯỚNG DẪN SỬ DỤNG SCRIPT DỌN DẸP MÃ NHÂN VIÊN
===============================================

1. So sánh mã nhân viên:
   compareEmployees()

2. Xóa tất cả mã nhân viên dư thừa:
   cleanupAllRedundant()

3. Xuất báo cáo:
   exportReport()

4. Hiển thị hướng dẫn:
   showHelp()

📋 LƯU Ý:
- Chạy từ tab Settings trong ứng dụng
- Đảm bảo đã đăng nhập với quyền Admin
- Script sẽ tự động tìm settings component
- Kết quả sẽ hiển thị trong UI và console

🚀 BẮT ĐẦU:
compareEmployees()
  `);
}

// Tự động hiển thị hướng dẫn khi load script
showHelp();

// Export functions để có thể gọi từ console
window.compareEmployees = compareEmployees;
window.cleanupAllRedundant = cleanupAllRedundant;
window.exportReport = exportReport;
window.showHelp = showHelp;
