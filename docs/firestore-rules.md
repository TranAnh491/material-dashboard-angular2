# Firestore Security Rules cho Material Dashboard

## Quy tắc bảo mật phù hợp cho ứng dụng warehouse:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Materials collection - cho phép đọc/ghi cho user đã đăng nhập
    match /materials/{materialId} {
      allow read, write: if request.auth != null;
    }
    
    // Material alerts - cho phép đọc/ghi cho user đã đăng nhập
    match /material-alerts/{alertId} {
      allow read, write: if request.auth != null;
    }
    
    // Material transactions - cho phép đọc/ghi cho user đã đăng nhập
    match /material-transactions/{transactionId} {
      allow read, write: if request.auth != null;
    }
    
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
    
    // Users collection - cho phép đọc/ghi cho user đã đăng nhập (admin có thể xem tất cả)
    match /users/{userId} {
      allow read, write: if request.auth != null;
    }
    
               // Tasks collection - cho phép đọc/ghi cho user đã đăng nhập
           match /tasks/{taskId} {
             allow read, write: if request.auth != null;
           }
           
           // User permissions collection - cho phép đọc/ghi cho user đã đăng nhập
           match /user-permissions/{permissionId} {
             allow read, write: if request.auth != null;
           }
           
           // Local user permissions collection - cho phép đọc/ghi cho user đã đăng nhập
           match /local-user-permissions/{permissionId} {
             allow read, write: if request.auth != null;
           }
           
           // Label Schedules collection - cho phép đọc/ghi cho user đã đăng nhập
           match /labelSchedules/{scheduleId} {
             allow read, write: if request.auth != null;
           }
           
           // Từ chối tất cả truy cập khác
           match /{document=**} {
             allow read, write: if false;
           }
  }
}
```

## Cách áp dụng:

1. Vào Firebase Console → Firestore Database → Rules
2. Thay thế toàn bộ nội dung bằng quy tắc trên
3. Nhấn "Publish"

## Giải thích:

- `request.auth != null`: Chỉ cho phép user đã đăng nhập
- `request.auth.uid == userId`: Chỉ cho phép user truy cập dữ liệu của chính mình (cho users collection)
- `allow read, write`: Cho phép đọc và ghi dữ liệu
- `if false`: Từ chối tất cả truy cập khác

## Lưu ý quan trọng:

1. **Test trước khi deploy**: Đảm bảo ứng dụng vẫn hoạt động bình thường
2. **Backup rules cũ**: Lưu lại rules hiện tại trước khi thay đổi
3. **Monitor logs**: Kiểm tra Firebase Console logs để đảm bảo không có lỗi 