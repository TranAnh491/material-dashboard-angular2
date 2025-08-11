# Hướng dẫn xóa tài khoản ASP2101

## Mục đích
Xóa hoàn toàn tài khoản ASP2101 (HUỲNH MINH TÚ) khỏi hệ thống và bắt buộc đăng ký lại.

## Cách thực hiện

### Phương pháp 1: Sử dụng nút trong Settings (Khuyến nghị)

1. **Đăng nhập vào hệ thống** với tài khoản có quyền admin
2. **Vào trang Settings** (`/settings`)
3. **Tìm nút "Xóa tài khoản ASP2101"** (màu đỏ, có icon delete_forever)
4. **Click vào nút** và xác nhận xóa
5. **Hệ thống sẽ tự động:**
   - Xóa thông tin user khỏi Firestore
   - Xóa quyền hạn và phân quyền tab
   - Refresh danh sách users
   - Hiển thị thông báo thành công

### Phương pháp 2: Sử dụng Console Debug (Dành cho developer)

1. **Vào trang Settings** (`/settings`)
2. **Mở Developer Tools** (F12)
3. **Vào tab Console**
4. **Copy và paste script debug** từ file `debug-delete-asp2101.js`
5. **Chạy lệnh:** `deleteASP2101Account()`

## Các lệnh debug có sẵn

```javascript
// Xóa tài khoản ASP2101
deleteASP2101Account()

// Kiểm tra trạng thái tài khoản ASP2101
checkASP2101Status()

// Refresh danh sách users
refreshUsers()
```

## Những gì sẽ bị xóa

✅ **Firestore Collections:**
- `users/{uid}` - Thông tin user
- `user-permissions/{uid}` - Quyền xóa dữ liệu
- `user-tab-permissions/{uid}` - Quyền truy cập tab

⚠️ **Firebase Auth:**
- User vẫn tồn tại trong Firebase Auth (cần Admin SDK để xóa hoàn toàn)
- User sẽ không thể đăng nhập vì không có thông tin trong Firestore

## Kết quả sau khi xóa

1. **Tài khoản ASP2101 sẽ biến mất** khỏi danh sách users trong Settings
2. **Khi đăng nhập lại**, user sẽ cần đăng ký lại hoàn toàn
3. **Tất cả quyền hạn** sẽ bị reset về mặc định
4. **Lịch sử hoạt động** sẽ bị mất

## Khôi phục (nếu cần)

⚠️ **Lưu ý:** Việc xóa này không thể hoàn tác trực tiếp!

Để khôi phục, cần:
1. Tạo lại tài khoản mới với email `asp2101@asp.com`
2. Thiết lập lại quyền hạn và phân quyền tab
3. Cập nhật thông tin cá nhân

## Troubleshooting

### Lỗi "Không tìm thấy tài khoản ASP2101"
- Kiểm tra xem có đang ở trang Settings không
- Refresh trang và thử lại
- Kiểm tra console log để debug

### Lỗi "Permission denied"
- Đảm bảo đang đăng nhập với tài khoản có quyền admin
- Kiểm tra Firestore security rules
- Kiểm tra quyền truy cập collection `users`

### Lỗi "Network error"
- Kiểm tra kết nối internet
- Kiểm tra Firebase connection
- Thử lại sau vài giây

## Liên hệ hỗ trợ

Nếu gặp vấn đề, vui lòng:
1. Kiểm tra console log để lấy thông tin lỗi
2. Chụp màn hình lỗi
3. Liên hệ admin hoặc developer để hỗ trợ

---
*Hướng dẫn này được tạo để hỗ trợ việc xóa tài khoản ASP2101 một cách an toàn và hiệu quả.*
