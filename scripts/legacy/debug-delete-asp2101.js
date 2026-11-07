// Debug script để xóa tài khoản ASP2101
// Chạy script này trong Console của Developer Tools

console.log('🗑️ ASP2101 Account Deletion Debug Script');
console.log('=====================================');

// Function để xóa tài khoản ASP2101
async function deleteASP2101Account() {
  try {
    console.log('🔍 Tìm kiếm tài khoản ASP2101...');
    
    // Kiểm tra xem có đang ở trang Settings không
    if (!window.settingsComponent) {
      console.error('❌ Không tìm thấy Settings component! Vui lòng vào trang Settings trước.');
      return;
    }
    
    // Gọi method xóa ASP2101
    await window.settingsComponent.deleteASP2101Account();
    
    console.log('✅ Hoàn thành xóa tài khoản ASP2101!');
    
  } catch (error) {
    console.error('❌ Lỗi khi xóa tài khoản ASP2101:', error);
  }
}

// Function để kiểm tra trạng thái tài khoản ASP2101
function checkASP2101Status() {
  try {
    console.log('🔍 Kiểm tra trạng thái tài khoản ASP2101...');
    
    if (!window.settingsComponent) {
      console.error('❌ Không tìm thấy Settings component!');
      return;
    }
    
    const users = window.settingsComponent.firebaseUsers || [];
    const asp2101User = users.find(user => 
      user.email === 'asp2101@asp.com' || 
      user.displayName === 'HUỲNH MINH TÚ' ||
      user.employeeId === 'ASP2101'
    );
    
    if (asp2101User) {
      console.log('✅ Tìm thấy tài khoản ASP2101:', asp2101User);
      console.log('   - UID:', asp2101User.uid);
      console.log('   - Email:', asp2101User.email);
      console.log('   - Display Name:', asp2101User.displayName);
      console.log('   - Employee ID:', asp2101User.employeeId);
    } else {
      console.log('❌ Không tìm thấy tài khoản ASP2101 trong danh sách!');
    }
    
    console.log(`📊 Tổng số tài khoản: ${users.length}`);
    
  } catch (error) {
    console.error('❌ Lỗi khi kiểm tra trạng thái:', error);
  }
}

// Function để refresh danh sách users
async function refreshUsers() {
  try {
    console.log('🔄 Đang refresh danh sách users...');
    
    if (!window.settingsComponent) {
      console.error('❌ Không tìm thấy Settings component!');
      return;
    }
    
    await window.settingsComponent.manualRefreshUsers();
    console.log('✅ Đã refresh danh sách users!');
    
  } catch (error) {
    console.error('❌ Lỗi khi refresh users:', error);
  }
}

// Hiển thị hướng dẫn sử dụng
console.log('📋 Hướng dẫn sử dụng:');
console.log('1. deleteASP2101Account() - Xóa tài khoản ASP2101');
console.log('2. checkASP2101Status() - Kiểm tra trạng thái tài khoản ASP2101');
console.log('3. refreshUsers() - Refresh danh sách users');
console.log('');
console.log('⚠️ Lưu ý: Vui lòng vào trang Settings trước khi chạy các lệnh này!');
console.log('');

// Export functions để sử dụng
window.deleteASP2101Account = deleteASP2101Account;
window.checkASP2101Status = checkASP2101Status;
window.refreshUsers = refreshUsers;
