# 🔍 Troubleshooting Training Report - Không hiển thị dữ liệu

## 📋 Vấn đề
Training Report không hiển thị dữ liệu trong phần "Instruction and Test".

## 🔍 Nguyên nhân có thể

### 1. **Không có dữ liệu ASP employees trong Firebase**
- Service chỉ tìm kiếm employees có ID bắt đầu bằng "ASP"
- Nếu không có dữ liệu test nào với employeeId bắt đầu bằng "ASP", report sẽ trống

### 2. **Firebase Collections không tồn tại**
- Service tìm kiếm trong 3 collections:
  - `temperature-test-results`
  - `materials-test-results`
  - `finished-goods-test-results`

### 3. **Vấn đề với Firestore Rules**
- Rules mới có thể chặn truy cập dữ liệu
- Cần kiểm tra quyền truy cập

### 4. **Vấn đề với Authentication**
- User chưa đăng nhập
- AuthGuard chặn truy cập

## 🛠️ Cách khắc phục

### Bước 1: Kiểm tra dữ liệu Firebase

1. **Mở Developer Console** (F12)
2. **Vào trang Equipment** → **Training Report**
3. **Kiểm tra console logs** để xem:
   - Có lỗi Firebase không?
   - Có bao nhiêu documents được tìm thấy?
   - Có ASP employees nào không?

### Bước 2: Debug Firebase Data

Sử dụng các nút debug đã được thêm vào:

1. **Debug Firebase**: Kiểm tra tất cả collections
2. **Create Test Data**: Tạo dữ liệu test với ASP employees
3. **Clear Test Data**: Xóa dữ liệu test

### Bước 3: Kiểm tra Firestore Rules

Đảm bảo rules cho phép truy cập collections test:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Test results collections - cho phép đọc/ghi cho user đã đăng nhập
    match /temperature-test-results/{docId} {
      allow read, write: if request.auth != null;
    }
    
    match /materials-test-results/{docId} {
      allow read, write: if request.auth != null;
    }
    
    match /finished-goods-test-results/{docId} {
      allow read, write: if request.auth != null;
    }
    
    // ... other rules
  }
}
```

### Bước 4: Tạo dữ liệu test

Nếu không có dữ liệu, tạo test data:

1. **Vào trang Equipment**
2. **Mở Training Report**
3. **Nhấn "Create Test Data"**
4. **Refresh lại trang**

### Bước 5: Kiểm tra Authentication

1. **Đảm bảo đã đăng nhập**
2. **Kiểm tra Firebase Console** → Authentication
3. **Kiểm tra user có quyền truy cập**

## 🔧 Debug Commands

### Trong Browser Console:

```javascript
// Debug Firebase collections
await window.debugFirebaseService.debugAllCollections();

// Debug ASP employees specifically
await window.debugFirebaseService.debugASPEmployees();

// Create test data
await window.debugFirebaseService.createTestData();

// Clear test data
await window.debugFirebaseService.clearTestData();
```

### Kiểm tra Service trực tiếp:

```javascript
// Lấy training reports
const reports = await window.trainingReportService.getTrainingReports();
console.log('Training reports:', reports);
```

## 📊 Cấu trúc dữ liệu mong đợi

### Document trong Firebase collections:

```json
{
  "employeeId": "ASP001",
  "employeeName": "Nguyễn Văn A",
  "passed": true,
  "score": 85,
  "percentage": 85,
  "totalQuestions": 10,
  "completedAt": "2024-01-20T10:30:00Z",
  "signature": "data:image/png;base64,..."
}
```

## 🚨 Lỗi thường gặp

### 1. "Missing or insufficient permissions"
- **Giải pháp**: Kiểm tra Firestore Rules
- **Kiểm tra**: User đã đăng nhập chưa

### 2. "No documents found"
- **Giải pháp**: Tạo test data
- **Kiểm tra**: Collections có tồn tại không

### 3. "Network error"
- **Giải pháp**: Kiểm tra kết nối internet
- **Kiểm tra**: Firebase config đúng không

### 4. "ASP employees not found"
- **Giải pháp**: Tạo test với employeeId bắt đầu bằng "ASP"
- **Kiểm tra**: Dữ liệu có đúng format không

## ✅ Checklist

- [ ] Đã đăng nhập Firebase
- [ ] Firestore Rules cho phép truy cập
- [ ] Collections tồn tại trong Firebase
- [ ] Có dữ liệu với employeeId bắt đầu bằng "ASP"
- [ ] Console không có lỗi
- [ ] Service trả về dữ liệu
- [ ] UI hiển thị dữ liệu

## 📞 Hỗ trợ

Nếu vẫn gặp vấn đề:

1. **Kiểm tra console logs** để xem lỗi cụ thể
2. **Chụp màn hình** lỗi
3. **Kiểm tra Firebase Console** → Firestore Database
4. **Kiểm tra Authentication** status 