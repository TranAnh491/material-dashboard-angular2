# Hướng Dẫn Import Excel Vào Inventory

## Tổng Quan
Hệ thống đã được tối ưu hóa để import file Excel `Template_Ton_kho_Factory.xlsx` vào inventory một cách nhẹ nhàng và hiệu quả, giúp load web nhanh hơn.

## Tính Năng Mới

### 🚀 Import Tối Ưu
- **Batch Processing**: Xử lý dữ liệu theo batch (50 items/batch) để tránh block UI
- **Progress Tracking**: Hiển thị tiến trình import real-time với dialog đẹp mắt
- **Error Handling**: Xử lý lỗi thông minh và hiển thị thông báo rõ ràng
- **Duplicate Check**: Tự động kiểm tra và bỏ qua các item trùng lặp

### 📊 Giao Diện Người Dùng
- **Progress Dialog**: Dialog hiển thị tiến trình với progress bar và thông tin chi tiết
- **Real-time Updates**: Cập nhật tiến trình theo thời gian thực
- **Responsive Design**: Giao diện tương thích với mọi thiết bị

### 🔧 Tối Ưu Hiệu Suất
- **Web Workers**: Sử dụng setTimeout để tránh block main thread
- **Batch Operations**: Xử lý Firebase operations theo batch
- **Memory Management**: Quản lý bộ nhớ hiệu quả khi xử lý file lớn
- **Lazy Loading**: Chỉ load dữ liệu cần thiết

## Cách Sử Dụng

### 1. Chuẩn Bị File Excel
File Excel cần có cấu trúc như sau:
```
| Factory | Material Code | PO Number | Quantity | Type | Location |
|---------|---------------|-----------|----------|------|----------|
| ASM1    | MAT001       | PO001     | 100      | Type1| A1       |
| ASM2    | MAT002       | PO002     | 200      | Type2| B2       |
```

### 2. Import File
1. Vào trang **Materials Inventory**
2. Click nút **More** (⋮)
3. Chọn **Import Tồn kho hiện tại**
4. Chọn file Excel `Template_Ton_kho_Factory.xlsx`
5. Theo dõi tiến trình import trong dialog
6. Xem kết quả và xử lý lỗi (nếu có)

### 3. Theo Dõi Tiến Trình
- **Processing**: Đang xử lý dữ liệu
- **Completed**: Import hoàn thành thành công
- **Error**: Có lỗi xảy ra (xem chi tiết trong console)

## Cấu Trúc File Excel

### Header (Dòng 1)
- **Cột A**: Factory (ASM1, ASM2, ...)
- **Cột B**: Material Code (Mã hàng)
- **Cột C**: PO Number (Số đơn hàng)
- **Cột D**: Quantity (Số lượng)
- **Cột E**: Type (Loại hàng)
- **Cột F**: Location (Vị trí kho)

### Dữ Liệu (Từ dòng 2)
- Mỗi dòng đại diện cho một item trong kho
- Tất cả các trường bắt buộc phải có giá trị
- Quantity phải là số dương

## Xử Lý Lỗi

### Lỗi Thường Gặp
1. **File không đúng định dạng**: Chỉ hỗ trợ .xlsx, .xls, .csv
2. **File quá lớn**: Giới hạn 10MB
3. **Dữ liệu không hợp lệ**: Thiếu thông tin bắt buộc
4. **Item trùng lặp**: Material Code + PO Number đã tồn tại

### Cách Khắc Phục
1. Kiểm tra định dạng file
2. Giảm kích thước file (chia nhỏ nếu cần)
3. Kiểm tra dữ liệu trong Excel
4. Xem chi tiết lỗi trong console

## Tối Ưu Hóa

### Cho File Lớn (>1000 items)
- Chia file thành nhiều phần nhỏ
- Import từng phần một
- Sử dụng batch size 50 (mặc định)

### Cho File Nhỏ (<100 items)
- Có thể tăng batch size lên 100
- Import nhanh hơn với ít batch hơn

## Bảo Mật

### Kiểm Tra Quyền
- Chỉ user có quyền mới có thể import
- Kiểm tra factory access trước khi import
- Validate dữ liệu trước khi lưu vào database

### Xử Lý Dữ Liệu
- Sanitize input data
- Validate file type và size
- Check duplicate trước khi import

## Troubleshooting

### Import Chậm
- Kiểm tra kết nối internet
- Giảm batch size
- Chia nhỏ file Excel

### Lỗi Firebase
- Kiểm tra quyền truy cập
- Xem log trong console
- Thử lại sau vài phút

### UI Không Responsive
- Đóng các tab không cần thiết
- Refresh trang nếu cần
- Kiểm tra memory usage

## Hỗ Trợ

Nếu gặp vấn đề, vui lòng:
1. Kiểm tra console log
2. Chụp màn hình lỗi
3. Liên hệ admin hoặc developer
4. Cung cấp thông tin file Excel (không có dữ liệu nhạy cảm)

## Changelog

### Version 2.0 (Hiện tại)
- ✅ Tối ưu hóa import với batch processing
- ✅ Progress dialog đẹp mắt
- ✅ Error handling thông minh
- ✅ Performance improvements

### Version 1.0 (Cũ)
- ❌ Import tuần tự (chậm)
- ❌ Không có progress tracking
- ❌ UI bị block khi import
- ❌ Error handling cơ bản
