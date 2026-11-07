# 🔧 HƯỚNG DẪN KHẮC PHỤC: Danh sách Email không hiển thị đầy đủ trong Settings

## 🚨 Vấn đề đã được khắc phục

**Trước đây:** Danh sách email đã đăng nhập trong tab Settings không hiển thị đầy đủ tất cả users.

**Nguyên nhân:** 
- Chỉ đọc từ collection 'users' 
- Không có cơ chế tự động thêm user mới
- Thiếu real-time listener để cập nhật danh sách

## ✅ Giải pháp đã triển khai

### **1. Cải thiện việc load users**
- **Đọc từ nhiều nguồn:** `users` collection + `user-permissions` collection
- **Tự động thêm current user:** Đảm bảo user đang đăng nhập luôn có trong danh sách
- **Loại bỏ duplicates:** Sử dụng UID để tránh trùng lặp

### **2. Real-time listeners**
- **Collection listeners:** Tự động cập nhật khi có thay đổi trong `users` hoặc `user-permissions`
- **Auth state listener:** Theo dõi khi có user mới đăng nhập/đăng xuất

### **3. Tự động tạo user mới**
- **Auto-create:** User mới đăng nhập lần đầu sẽ tự động được tạo trong Firestore
- **Default permissions:** Tự động tạo permissions mặc định cho user mới

## 🎯 Cách sử dụng các tính năng mới

### **Nút "Làm mới" (Refresh)**
- **Chức năng:** Tải lại danh sách users từ Firestore
- **Khi nào dùng:** Khi muốn cập nhật danh sách thủ công

### **Nút "Khám phá" (Discover)**
- **Chức năng:** Tìm kiếm users có thể bị thiếu
- **Khi nào dùng:** Khi nghi ngờ danh sách không đầy đủ
- **Kết quả:** Hiển thị thông tin debug trong console

### **Nút "Trạng thái" (Status)**
- **Chức năng:** Kiểm tra trạng thái Firestore và quyền truy cập
- **Khi nào dùng:** Khi gặp lỗi hoặc muốn debug
- **Kết quả:** Hiển thị thông tin chi tiết trong console

### **Nút "Sửa" (Edit)**
- **Chức năng:** Chỉnh sửa quyền của users
- **Khi nào dùng:** Khi muốn thay đổi role, department, factory của users

## 🔍 Cách kiểm tra và debug

### **1. Mở Browser Console (F12)**
- Vào Settings → Firebase Users
- Nhấn F12 để mở Developer Tools
- Chọn tab Console

### **2. Sử dụng các nút debug**
```
1. Nhấn "Trạng thái" → Kiểm tra quyền truy cập Firestore
2. Nhấn "Khám phá" → Xem danh sách users hiện tại
3. Nhấn "Làm mới" → Tải lại danh sách
```

### **3. Kiểm tra logs**
```
✅ Loaded X users from Firestore
✅ Added user from permissions: email@example.com
✅ Current user: email@example.com (uid)
✅ Real-time user listeners established
```

## 🚀 Tính năng tự động

### **Auto-refresh khi có thay đổi**
- Khi có user mới đăng nhập → Tự động thêm vào danh sách
- Khi có thay đổi trong Firestore → Tự động cập nhật giao diện
- Khi user đăng xuất → Tự động cập nhật trạng thái

### **Auto-create user mới**
- User đăng nhập lần đầu → Tự động tạo trong `users` collection
- Tự động tạo permissions mặc định trong `user-permissions`
- Cập nhật `lastLoginAt` mỗi lần đăng nhập

## 📊 Hiển thị thông tin

### **User Count Display**
- Hiển thị số lượng users đã tìm thấy: `(X users)`
- Cập nhật real-time khi có thay đổi

### **Table Columns**
- **Tài khoản:** Email của user
- **Vai trò:** Role (User, Quản lý, Admin)
- **Bộ phận:** Department
- **Nhà máy:** Factory
- **Tên:** Display name
- **Ngày tạo:** Created date
- **Xóa:** Delete permission
- **Hoàn thành:** Complete permission
- **Tab permissions:** Access to specific tabs

## 🛠️ Troubleshooting

### **Nếu danh sách vẫn trống:**

1. **Kiểm tra đăng nhập:**
   - Đảm bảo đã đăng nhập vào hệ thống
   - Kiểm tra console có lỗi gì không

2. **Kiểm tra Firestore Rules:**
   - Vào Firebase Console → Firestore → Rules
   - Đảm bảo rules cho phép đọc collection `users` và `user-permissions`

3. **Sử dụng nút "Trạng thái":**
   - Nhấn nút "Trạng thái" để kiểm tra quyền truy cập
   - Xem logs trong console để tìm vấn đề

4. **Refresh và thử lại:**
   - Nhấn F5 để refresh trang
   - Nhấn nút "Làm mới" để tải lại danh sách

### **Nếu có lỗi trong console:**

1. **Permission denied:** Cập nhật Firestore Rules
2. **Network error:** Kiểm tra kết nối internet
3. **Auth error:** Đăng nhập lại vào hệ thống

## 📝 Lưu ý quan trọng

- **Không cần restart app:** Các thay đổi sẽ tự động áp dụng
- **Real-time updates:** Danh sách sẽ tự động cập nhật khi có thay đổi
- **Performance:** Sử dụng efficient listeners để tránh lag
- **Error handling:** Tất cả lỗi đều được log và xử lý gracefully

## 🎉 Kết quả mong đợi

Sau khi áp dụng các cải tiến này, bạn sẽ thấy:

✅ **Danh sách users đầy đủ** - Tất cả email đã đăng nhập sẽ hiển thị  
✅ **Auto-update** - Danh sách tự động cập nhật khi có thay đổi  
✅ **Better debugging** - Các nút debug giúp tìm và khắc phục vấn đề  
✅ **User count display** - Hiển thị rõ số lượng users đã tìm thấy  
✅ **Improved UX** - Giao diện thân thiện và dễ sử dụng hơn  

---

**Nếu vẫn gặp vấn đề, hãy sử dụng các nút debug và kiểm tra console logs để tìm nguyên nhân cụ thể.**
