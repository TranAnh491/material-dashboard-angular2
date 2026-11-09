# 🔧 Hướng dẫn Fix Training Report - Không hiển thị dữ liệu

## 📋 Vấn đề
Training Report không hiển thị dữ liệu, chỉ hiển thị "Chưa có dữ liệu báo cáo".

## 🔍 Nguyên nhân chính

### 1. **Không có dữ liệu ASP employees**
- Service chỉ tìm kiếm employees có ID bắt đầu bằng "ASP"
- Dữ liệu cũ có thể có employeeId khác format

### 2. **Dữ liệu cũ không đúng format**
- EmployeeId không bắt đầu bằng "ASP"
- Thiếu các trường bắt buộc

### 3. **Vấn đề Firestore Rules**
- Rules mới chặn truy cập collections test

## 🛠️ Cách khắc phục

### Bước 1: Debug chi tiết

1. **Mở Developer Console** (F12)
2. **Vào trang Equipment** → **Training Report**
3. **Chạy script debug**:

```javascript
// Copy và paste vào console
// File: debug-training-report.js
```

### Bước 2: Kiểm tra kết quả debug

Sau khi chạy debug, kiểm tra:

1. **Có collections nào không?**
   - `temperature-test-results`
   - `materials-test-results`
   - `finished-goods-test-results`

2. **Có dữ liệu nào không?**
   - Tổng số documents
   - Employee IDs có đúng format không

3. **Có ASP employees không?**
   - EmployeeId bắt đầu bằng "ASP"
   - Nếu không có, cần tạo hoặc convert

### Bước 3: Fix dựa trên kết quả

#### **Trường hợp 1: Không có dữ liệu**
```javascript
// Tạo dữ liệu test ASP
await window.trainingReportDebugService.createASPTestData();
```

#### **Trường hợp 2: Có dữ liệu nhưng không phải ASP**
```javascript
// Convert dữ liệu cũ sang ASP format
await window.trainingReportDebugService.convertToASPFormat();
```

#### **Trường hợp 3: Lỗi Firestore Rules**
```javascript
// Test access
await window.trainingReportDebugService.testFirestoreAccess();
```

### Bước 4: Cập nhật Firestore Rules

Nếu có lỗi access, cập nhật rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Test results collections
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

## 🔧 Debug Tools

### Nút Debug trong UI:
1. **Debug Firebase**: Kiểm tra tất cả collections
2. **Debug Details**: Chi tiết từng document
3. **Check Non-ASP**: Tìm dữ liệu không đúng format
4. **Convert to ASP**: Chuyển đổi dữ liệu cũ
5. **Create ASP Data**: Tạo dữ liệu test mới

### Console Commands:
```javascript
// Debug tổng hợp
await window.debugTrainingReport.runComprehensiveDebug();

// Quick fix
await window.debugTrainingReport.quickFix();

// Debug từng bước
await window.debugTrainingReport.debugAllCollections();
await window.debugTrainingReport.checkNonASPData();
await window.debugTrainingReport.convertToASP();
```

## 📊 Cấu trúc dữ liệu mong đợi

### Document trong Firebase:
```json
{
  "employeeId": "ASP001",           // ⚠️ PHẢI bắt đầu bằng "ASP"
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
- **Giải pháp**: Cập nhật Firestore Rules
- **Kiểm tra**: User đã đăng nhập chưa

### 2. "No ASP employees found"
- **Giải pháp**: Tạo dữ liệu ASP hoặc convert dữ liệu cũ
- **Kiểm tra**: EmployeeId có đúng format không

### 3. "Collections not found"
- **Giải pháp**: Tạo collections trong Firebase Console
- **Kiểm tra**: Tên collections có đúng không

### 4. "Data exists but not showing"
- **Giải pháp**: Kiểm tra service logic
- **Kiểm tra**: Console logs để debug

## ✅ Checklist

- [ ] Đã đăng nhập Firebase
- [ ] Firestore Rules cho phép truy cập
- [ ] Collections tồn tại trong Firebase
- [ ] Có dữ liệu với employeeId bắt đầu bằng "ASP"
- [ ] Console không có lỗi
- [ ] Service trả về dữ liệu
- [ ] UI hiển thị dữ liệu

## 🎯 Quick Fix

Nếu muốn fix nhanh:

1. **Chạy script debug**:
```javascript
// Copy debug-training-report.js và paste vào console
```

2. **Nếu không có dữ liệu ASP**:
```javascript
await window.trainingReportDebugService.createASPTestData();
```

3. **Nếu có dữ liệu cũ**:
```javascript
await window.trainingReportDebugService.convertToASPFormat();
```

4. **Refresh trang** và kiểm tra lại

## 📞 Hỗ trợ

Nếu vẫn gặp vấn đề:

1. **Chụp màn hình** console logs
2. **Kiểm tra Firebase Console** → Firestore Database
3. **Kiểm tra Authentication** status
4. **Chạy debug script** và chia sẻ kết quả 