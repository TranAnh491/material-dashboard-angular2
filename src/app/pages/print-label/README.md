# Print Label Component - Hướng dẫn sử dụng

## Tính năng mới đã cập nhật

### 📸 Chụp hình 2 bước

**Chức năng chụp hình đã được nâng cấp để chụp 2 loại hình ảnh:**

1. **Bước 1: Chụp bản vẽ thiết kế**
   - Đặt bản vẽ thiết kế vào giữa khung hình
   - Đảm bảo đủ ánh sáng và chụp rõ nét
   - Hình sẽ được tối ưu hóa và lưu vào Firebase

2. **Bước 2: Chụp tem đã in**
   - Đặt tem đã in vào giữa khung hình
   - Đảm bảo đủ ánh sáng và chụp rõ nét
   - Hình sẽ được tối ưu hóa và lưu vào Firebase

**Quy trình chụp hình:**
1. Click nút 📸 trong bảng Print Schedules
2. Chụp bản vẽ thiết kế (Bước 1/2)
3. Xác nhận tiếp tục chụp tem in
4. Chụp tem đã in (Bước 2/2)
5. Hoàn thành và lưu vào Firebase

### 💾 Giới hạn dung lượng

- **Mỗi hình ảnh**: Tối đa 250KB
- **Tự động tối ưu hóa**: Hình ảnh được nén tự động
- **Lưu trữ riêng biệt**: Bản vẽ và tem in được lưu riêng

### 📦 Tải về ZIP theo tháng

**Tính năng mới: Tải về tất cả hình ảnh theo tháng**

1. **Chọn tháng**: Click nút "📦 Tải ZIP theo tháng"
2. **Chọn tháng**: Chọn tháng từ danh sách (12 tháng gần nhất)
3. **Tải về**: File ZIP sẽ được tạo và tải về tự động

**Cấu trúc file ZIP:**
```
photos-2024-01.zip
├── item_001_design_1.jpg
├── item_001_printed_1.jpg
├── item_002_design_1.jpg
├── item_002_printed_1.jpg
└── ...
```

### 📊 Báo cáo nâng cao

**Thống kê chi tiết:**
- 📷 Đã chụp: Tổng số item đã chụp
- 📐 Bản vẽ: Số item đã chụp bản vẽ
- 🏷️ Tem in: Số item đã chụp tem in
- ✅ Cả 2: Số item đã chụp cả 2 loại

**Bảng báo cáo:**
- Hiển thị trạng thái chụp từng loại hình
- ✅ = Đã chụp, ⏳ = Chưa chụp
- Thao tác xem, tải về, xóa hình

### 📸 Chụp và lưu trữ

**Chức năng chụp hình đơn giản:**
- Chụp bản vẽ thiết kế (Bước 1/2)
- Chụp tem đã in (Bước 2/2)
- Lưu trữ riêng biệt trong Firebase
- Hiển thị trạng thái hoàn thành

### 🎯 Cách sử dụng

1. **Import dữ liệu**: Upload file Excel vào Print Schedules
2. **Chụp hình**: Click nút 📸 cho từng item
3. **Theo dõi tiến độ**: Xem thống kê trong Check Label
4. **Tải báo cáo**: Export Excel hoặc ZIP theo tháng
5. **Quản lý hình ảnh**: Xem, tải về, xóa hình trong Check Label
6. **Lưu trữ**: Hình ảnh được lưu riêng biệt và có thể truy cập sau

### ⚙️ Cài đặt kỹ thuật

**Yêu cầu:**
- Camera hỗ trợ (webcam hoặc camera điện thoại)
- Kết nối internet để lưu vào Firebase
- Trình duyệt hiện đại hỗ trợ HTML5

**Tối ưu hóa:**
- Hình ảnh được nén tự động
- Lưu trữ hiệu quả trong Firebase
- Giao diện responsive cho mobile

### 🚀 Tính năng sắp tới

- [ ] Tích hợp JSZip để tạo file ZIP thực
- [ ] OCR để đọc text từ hình ảnh
- [ ] AI so sánh hình ảnh nâng cao
- [ ] Backup và restore dữ liệu
- [ ] Export PDF báo cáo 