// Debug script để test logic hiển thị tài khoản mới
// Chạy script này trong Console của Developer Tools

console.log('🔍 Account Display Logic Test Script');
console.log('===================================');

// Function để test logic hiển thị tài khoản
function testAccountDisplay() {
  try {
    console.log('🧪 Testing account display logic...');
    
    // Kiểm tra xem có đang ở trang Settings không
    if (!window.settingsComponent) {
      console.error('❌ Không tìm thấy Settings component! Vui lòng vào trang Settings trước.');
      return;
    }
    
    const users = window.settingsComponent.firebaseUsers || [];
    console.log(`📊 Tổng số tài khoản: ${users.length}`);
    
    // Test các trường hợp khác nhau
    users.forEach((user, index) => {
      const display = window.settingsComponent.getAccountDisplay(user);
      const typeLabel = window.settingsComponent.getAccountTypeLabel(user);
      const typeIcon = window.settingsComponent.getAccountTypeIcon(user);
      
      console.log(`\n👤 User ${index + 1}:`);
      console.log(`   - Email: ${user.email}`);
      console.log(`   - Display Name: ${user.displayName || 'N/A'}`);
      console.log(`   - Employee ID: ${user.employeeId || 'N/A'}`);
      console.log(`   - Display: ${display}`);
      console.log(`   - Type: ${typeLabel} ${typeIcon}`);
      
      // Kiểm tra logic đặc biệt cho email asp
      if (user.email && user.email.toLowerCase().startsWith('asp')) {
        const email = user.email.toLowerCase();
        const match = email.match(/^asp(\d{4})@/);
        if (match) {
          console.log(`   ✅ Email ASP detected: ${match[1]} -> ASP${match[1]}`);
        } else {
          console.log(`   ⚠️ Email ASP không đúng format: ${user.email}`);
        }
      }
    });
    
    console.log('\n✅ Test hoàn thành!');
    
  } catch (error) {
    console.error('❌ Lỗi khi test:', error);
  }
}

// Function để tìm tài khoản cụ thể
function findSpecificAccount(searchTerm) {
  try {
    console.log(`🔍 Tìm kiếm tài khoản: ${searchTerm}`);
    
    if (!window.settingsComponent) {
      console.error('❌ Không tìm thấy Settings component!');
      return;
    }
    
    const users = window.settingsComponent.firebaseUsers || [];
    const foundUsers = users.filter(user => 
      user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.displayName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.employeeId?.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    if (foundUsers.length > 0) {
      console.log(`✅ Tìm thấy ${foundUsers.length} tài khoản:`);
      foundUsers.forEach((user, index) => {
        const display = window.settingsComponent.getAccountDisplay(user);
        const typeLabel = window.settingsComponent.getAccountTypeLabel(user);
        const typeIcon = window.settingsComponent.getAccountTypeIcon(user);
        
        console.log(`\n   ${index + 1}. ${display}`);
        console.log(`      - Email: ${user.email}`);
        console.log(`      - Display Name: ${user.displayName || 'N/A'}`);
        console.log(`      - Employee ID: ${user.employeeId || 'N/A'}`);
        console.log(`      - Type: ${typeLabel} ${typeIcon}`);
      });
    } else {
      console.log(`❌ Không tìm thấy tài khoản nào chứa: ${searchTerm}`);
    }
    
  } catch (error) {
    console.error('❌ Lỗi khi tìm kiếm:', error);
  }
}

// Function để test logic với dữ liệu mẫu
function testWithSampleData() {
  try {
    console.log('🧪 Testing with sample data...');
    
    if (!window.settingsComponent) {
      console.error('❌ Không tìm thấy Settings component!');
      return;
    }
    
    // Tạo dữ liệu mẫu
    const sampleUsers = [
      { email: 'asp2197@asp.com', displayName: 'Nguyễn Văn A', employeeId: null },
      { email: 'asp1234@asp.com', displayName: 'Trần Thị B', employeeId: null },
      { email: 'user@example.com', displayName: 'User C', employeeId: null },
      { email: 'admin@company.com', displayName: 'Admin D', employeeId: 'ADM001' }
    ];
    
    sampleUsers.forEach((user, index) => {
      console.log(`\n📝 Sample User ${index + 1}:`);
      console.log(`   - Email: ${user.email}`);
      console.log(`   - Display Name: ${user.displayName}`);
      console.log(`   - Employee ID: ${user.employeeId || 'N/A'}`);
      
      // Test logic hiển thị
      const display = window.settingsComponent.getAccountDisplay(user);
      const typeLabel = window.settingsComponent.getAccountTypeLabel(user);
      const typeIcon = window.settingsComponent.getAccountTypeIcon(user);
      
      console.log(`   - Display: ${display}`);
      console.log(`   - Type: ${typeLabel} ${typeIcon}`);
    });
    
    console.log('\n✅ Sample data test hoàn thành!');
    
  } catch (error) {
    console.error('❌ Lỗi khi test sample data:', error);
  }
}

// Hiển thị hướng dẫn sử dụng
console.log('📋 Hướng dẫn sử dụng:');
console.log('1. testAccountDisplay() - Test logic hiển thị tất cả tài khoản');
console.log('2. findSpecificAccount("search_term") - Tìm tài khoản cụ thể');
console.log('3. testWithSampleData() - Test với dữ liệu mẫu');
console.log('');
console.log('💡 Ví dụ: findSpecificAccount("asp2197")');
console.log('⚠️ Lưu ý: Vui lòng vào trang Settings trước khi chạy các lệnh này!');
console.log('');

// Export functions để sử dụng
window.testAccountDisplay = testAccountDisplay;
window.findSpecificAccount = findSpecificAccount;
window.testWithSampleData = testWithSampleData;
