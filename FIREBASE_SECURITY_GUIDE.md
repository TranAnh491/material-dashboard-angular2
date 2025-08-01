# 🔐 Hướng dẫn Firebase Security cho Material Dashboard

## 📋 Tổng quan

Ứng dụng Material Dashboard đã được cập nhật để sử dụng Firebase Authentication và Firestore Security Rules để bảo vệ dữ liệu.

## 🚀 Các bước thực hiện

### 1. Cập nhật Firestore Rules

Vào Firebase Console → Firestore Database → Rules và thay thế bằng:

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
    
    // Users collection - chỉ user đó mới truy cập được dữ liệu của mình
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Tasks collection - cho phép đọc/ghi cho user đã đăng nhập
    match /tasks/{taskId} {
      allow read, write: if request.auth != null;
    }
    
    // Từ chối tất cả truy cập khác
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### 2. Enable Firebase Authentication

1. Vào Firebase Console → Authentication
2. Nhấn "Get started"
3. Chọn "Sign-in method" tab
4. Enable "Email/Password" provider
5. Nhấn "Save"

### 3. Test Authentication

1. Chạy ứng dụng: `ng serve`
2. Truy cập: `http://localhost:4200/login`
3. Đăng ký tài khoản mới hoặc đăng nhập
4. Kiểm tra xem có thể truy cập các trang được bảo vệ không

## 🔧 Các file đã được tạo/cập nhật

### Services
- `src/app/services/firebase-auth.service.ts` - Service xử lý authentication
- `src/app/guards/auth.guard.ts` - Guard bảo vệ routes

### Components
- `src/app/pages/login/login.component.ts` - Component đăng nhập/đăng ký
- `src/app/pages/login/login.component.html` - Template login
- `src/app/pages/login/login.component.scss` - Styles login

### Routing
- `src/app/app.routing.ts` - Thêm route login
- `src/app/layouts/admin-layout/admin-layout.routing.ts` - Thêm AuthGuard

### Navbar
- `src/app/components/navbar/navbar.component.ts` - Thêm user info và logout
- `src/app/components/navbar/navbar.component.html` - Hiển thị user dropdown

## 🔒 Bảo mật

### Firestore Rules giải thích:

1. **`request.auth != null`**: Chỉ cho phép user đã đăng nhập
2. **`request.auth.uid == userId`**: Chỉ cho phép user truy cập dữ liệu của chính mình
3. **`allow read, write`**: Cho phép đọc và ghi dữ liệu
4. **`if false`**: Từ chối tất cả truy cập khác

### AuthGuard:
- Kiểm tra trạng thái đăng nhập trước khi cho phép truy cập
- Tự động chuyển về trang login nếu chưa đăng nhập

## 🧪 Testing

### Test Cases:

1. **Chưa đăng nhập**:
   - Truy cập `/dashboard` → Chuyển về `/login`
   - Truy cập bất kỳ trang nào → Chuyển về `/login`

2. **Đã đăng nhập**:
   - Truy cập `/login` → Chuyển về `/dashboard`
   - Truy cập các trang khác → Bình thường

3. **Đăng xuất**:
   - Click nút "Đăng xuất" → Chuyển về `/login`
   - Không thể truy cập các trang được bảo vệ

## ⚠️ Lưu ý quan trọng

1. **Backup rules cũ** trước khi thay đổi
2. **Test kỹ** trước khi deploy production
3. **Monitor logs** trong Firebase Console
4. **Kiểm tra performance** sau khi áp dụng rules

## 🐛 Troubleshooting

### Lỗi thường gặp:

1. **"Missing or insufficient permissions"**:
   - Kiểm tra user đã đăng nhập chưa
   - Kiểm tra rules có đúng syntax không

2. **"User not found"**:
   - Kiểm tra Firebase Auth đã enable chưa
   - Kiểm tra user đã được tạo trong Firestore chưa

3. **"Network error"**:
   - Kiểm tra kết nối internet
   - Kiểm tra Firebase config

## 📞 Hỗ trợ

Nếu gặp vấn đề, kiểm tra:
1. Firebase Console logs
2. Browser console errors
3. Network tab trong DevTools 