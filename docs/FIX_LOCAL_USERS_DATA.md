# 🔧 FIX: Local Users không lấy được dữ liệu cũ

## 🚨 Vấn đề

Tab "Local Users" trong Settings không hiển thị dữ liệu cũ từ Firebase.

## 🔍 Nguyên nhân

Có xung đột collection names:
- **Local Users** (employeeId, password) và **Firebase Users** (uid, email) đều dùng collection `user-permissions`
- Cấu trúc dữ liệu khác nhau nhưng cùng collection name
- Permission service không lấy được dữ liệu đúng

## ⚡ Giải pháp

### **1. Tách collection riêng biệt:**
- `user-permissions` → Cho Firebase Users (uid, email, hasEditPermission)
- `local-user-permissions` → Cho Local Users (employeeId, password, hasDeletePermission)

### **2. Migrate dữ liệu cũ**

## 🛠️ Cách sửa

### **Bước 1: Cập nhật Firestore Rules**
1. Vào Firebase Console → Firestore Database → Rules
2. Thêm rules cho collection mới:

```javascript
// Local user permissions collection
match /local-user-permissions/{permissionId} {
  allow read, write: if request.auth != null;
}
```

### **Bước 2: Migrate dữ liệu**
1. Mở browser console (F12)
2. Copy script từ file `migrate-local-users.js`
3. Chạy lệnh:

```javascript
migrateLocalUsersData();
```

### **Bước 3: Refresh trang**
1. Nhấn F5 hoặc Ctrl+R
2. Vào Settings → Local Users
3. Dữ liệu cũ sẽ hiển thị

## 📊 Cấu trúc dữ liệu

### **Before (Cũ):**
```javascript
// Collection: user-permissions
{
  // Local Users
  employeeId: "EMP001",
  password: "password123", 
  hasDeletePermission: true,
  
  // Firebase Users (conflict!)
  uid: "firebase_uid",
  email: "user@example.com",
  hasEditPermission: true
}
```

### **After (Mới):**
```javascript
// Collection: local-user-permissions
{
  employeeId: "EMP001",
  password: "password123",
  hasDeletePermission: true,
  createdAt: Date,
  updatedAt: Date
}

// Collection: user-permissions  
{
  uid: "firebase_uid",
  email: "user@example.com", 
  hasEditPermission: true,
  createdAt: Date,
  lastLoginAt: Date
}
```

## 🔧 Debug Commands

### **Kiểm tra dữ liệu:**
```javascript
justCheckData();
```

### **Tạo test data:**
```javascript
createTestLocalUsers();
```

### **Migrate manual:**
```javascript
// Kiểm tra dữ liệu cũ
checkOldData();

// Migrate dữ liệu
migrateLocalUsers(localUsers);

// Kiểm tra dữ liệu mới
checkNewData();
```

## 📁 Files đã cập nhật

1. `src/app/services/permission.service.ts` - Đổi collection name
2. `firestore-rules.md` - Thêm rules cho local-user-permissions
3. `migrate-local-users.js` - Script migrate data
4. `FIX_LOCAL_USERS_DATA.md` - Hướng dẫn này

## 🎯 Kết quả mong đợi

Sau khi fix:
- ✅ Tab "Local Users" hiển thị dữ liệu cũ
- ✅ Tab "Firebase Users" hoạt động bình thường
- ✅ Không có xung đột collection names
- ✅ Có thể thêm/sửa/xóa local users
- ✅ Có thể quản lý quyền Firebase users

## 🚨 Lưu ý quan trọng

1. **Backup dữ liệu** trước khi migrate
2. **Test** trên môi trường dev trước
3. **Kiểm tra** cả 2 tabs hoạt động đúng
4. **Xóa dữ liệu cũ** chỉ khi chắc chắn

## 📋 Test Cases

### **Local Users Tab:**
- [ ] Hiển thị danh sách employees (EMP001, EMP002, Admin)
- [ ] Thêm employee mới
- [ ] Chỉnh sửa password và quyền
- [ ] Xóa employee

### **Firebase Users Tab:**
- [ ] Hiển thị danh sách emails đăng nhập
- [ ] Toggle quyền chỉnh sửa
- [ ] Lưu/hủy thay đổi quyền
- [ ] Xóa Firebase user

## 🆘 Troubleshooting

### **Vẫn không hiển thị data:**
1. Kiểm tra console logs
2. Kiểm tra Firestore Rules
3. Chạy lại migrate script
4. Refresh trang

### **Lỗi permission:**
1. Cập nhật Firestore Rules
2. Kiểm tra user đã đăng nhập
3. Test với admin account

### **Data bị duplicate:**
1. Xóa dữ liệu cũ: `cleanupOldData(localUsers)`
2. Kiểm tra collection `user-permissions` không còn local users
3. Chỉ giữ lại data trong `local-user-permissions` 