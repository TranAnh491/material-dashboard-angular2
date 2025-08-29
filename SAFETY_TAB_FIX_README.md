# 🔧 Sửa lỗi Tab Safety - Số lượng scan không nhảy vào dòng có sẵn

## 🚨 Vấn đề đã được xác định

Trong tab Safety, khi nhập lượng ở ASM1 hoặc ASM2, số lượng được scan/nhập đang tạo dòng mới thay vì cập nhật vào dòng có sẵn.

## ✅ Giải pháp đã thực hiện

### 1. Sửa đổi logic `addOrUpdateScannedMaterial`

**Trước đây:**
- Hệ thống tìm kiếm material theo `materialCode` và `scanDate`
- Có thể tạo dòng mới nếu không tìm thấy theo cả hai điều kiện

**Sau khi sửa:**
- Hệ thống LUÔN tìm kiếm material theo `materialCode` (không quan tâm `scanDate`)
- Nếu tìm thấy material có sẵn, sẽ cập nhật dòng đó thay vì tạo mới
- Chỉ tạo material mới khi thực sự không có material nào với mã hàng đó

### 2. Thêm tính năng gộp dòng trùng lặp

**Button "Gộp Dòng Trùng":**
- Tự động tìm và gộp các dòng có cùng `materialCode`
- Tính tổng số lượng từ tất cả các dòng trùng lặp
- Giữ lại dòng cũ nhất và xóa các dòng trùng lặp
- Cập nhật `scanDate` thành ngày hiện tại

**Button "Kiểm Tra Trùng":**
- Kiểm tra và hiển thị thông tin về các dòng trùng lặp
- Hiển thị số lượng dòng trùng lặp cho mỗi mã hàng
- Cung cấp thông tin chi tiết để người dùng quyết định có gộp hay không

### 3. Cải thiện logging và thông báo

- Thêm log chi tiết để debug quá trình scan
- Hiển thị thông báo rõ ràng về việc cập nhật dòng có sẵn
- Cảnh báo khi có dòng trùng lặp

## 🎯 Cách hoạt động mới

### Khi scan ASM1 hoặc ASM2:

1. **Tìm kiếm material:** Hệ thống tìm kiếm theo `materialCode`
2. **Nếu tìm thấy:** Cập nhật số lượng vào dòng có sẵn
   - ASM1: Cộng dồn vào `quantityASM1`
   - ASM2: Cộng dồn vào `quantityASM2`
   - Cập nhật `totalQuantity` và `scanDate`
3. **Nếu không tìm thấy:** Tạo material mới

### Xử lý dòng trùng lặp:

1. **Kiểm tra:** Sử dụng button "Kiểm Tra Trùng" để xem có dòng trùng lặp nào
2. **Gộp:** Sử dụng button "Gộp Dòng Trùng" để tự động gộp
3. **Kết quả:** Chỉ còn lại một dòng duy nhất cho mỗi mã hàng

## 🚀 Cách sử dụng

### 1. Scan bình thường:
- Bấm nút ASM1 hoặc ASM2 để bắt đầu scan
- Scan tem theo định dạng: `Rxxxxxx yyyy` hoặc `Bxxxxxx yyyy`
- Số lượng sẽ tự động nhảy vào dòng có sẵn

### 2. Xử lý dòng trùng lặp:
- Bấm "Kiểm Tra Trùng" để xem tình trạng
- Bấm "Gộp Dòng Trùng" để tự động gộp
- Refresh để xem kết quả

### 3. Kiểm tra kết quả:
- Xem console log để theo dõi quá trình
- Kiểm tra bảng dữ liệu sau khi scan
- Đảm bảo số lượng được cộng dồn đúng

## 🔍 Debug và Troubleshooting

### Console Log:
- `✅ Tìm thấy material có sẵn: [mã hàng] - sẽ cập nhật thay vì tạo mới`
- `🔄 Cập nhật số lượng ASM1/ASM2: [số cũ] + [số mới] = [tổng]`
- `⚠️ [mã hàng]: [số dòng] dòng ([số dòng trùng lặp] dòng trùng lặp)`

### Các trường hợp cần chú ý:
1. **Material mới:** Sẽ tạo dòng mới (đúng)
2. **Material có sẵn:** Sẽ cập nhật dòng có sẵn (đã sửa)
3. **Dòng trùng lặp:** Sử dụng button gộp để xử lý

## 📝 Lưu ý quan trọng

- **Luôn cập nhật dòng có sẵn:** Số lượng scan sẽ nhảy vào dòng có sẵn thay vì tạo mới
- **Gộp dòng trùng lặp:** Sử dụng tính năng gộp để tránh dữ liệu bị phân tán
- **Kiểm tra thường xuyên:** Sử dụng button kiểm tra để phát hiện vấn đề sớm
- **Backup dữ liệu:** Nên backup trước khi gộp dòng trùng lặp

## 🎉 Kết quả mong đợi

Sau khi áp dụng các thay đổi:
- ✅ Số lượng scan ASM1/ASM2 sẽ nhảy vào dòng có sẵn
- ✅ Không còn tạo dòng mới không cần thiết
- ✅ Dữ liệu được tập trung và dễ quản lý
- ✅ Có công cụ để xử lý dòng trùng lặp
- ✅ Hệ thống hoạt động ổn định và dễ debug
