# HƯỚNG DẪN SỬ DỤNG CHỨC NĂNG IMPORT TRONG TAB RM1 INVENTORY

## 🎯 Mục đích
Import dữ liệu catalog với cột **Standard Packing** để khắc phục vấn đề cột này không hiển thị số trong tab "RM1 Inventory".

## 📍 Vị trí chức năng
- **Tab**: "RM1 Inventory" 
- **Nút**: "More" (3 chấm dọc)
- **Menu dropdown**: Chọn "Import Catalog (Standard Packing)"

## 🚀 Cách sử dụng

### Bước 1: Tải template
1. Nhấn nút **"More"** trong tab "RM1 Inventory"
2. Chọn **"Download Catalog Template (Standard Packing)"**
3. File Excel sẽ được tải về với cấu trúc:
   ```
   Mã hàng | Tên hàng | Đơn vị | Standard Packing | Nhà cung cấp | Danh mục
   B001003  | Dây điện... | m      | 100              | Supplier A    | Cable
   ```

### Bước 2: Chuẩn bị dữ liệu
1. Mở file template đã tải về
2. **QUAN TRỌNG**: Điền giá trị thực tế cho cột "Standard Packing":
   - **KHÔNG để 0** - đây là nguyên nhân gây ra vấn đề
   - **Dây điện**: 100m, 200m, 500m (tùy package)
   - **Túi nhựa**: 50 cái, 100 cái, 200 cái
   - **Linh kiện**: 100 cái, 1000 cái
3. Lưu file với tên mới (ví dụ: `updated_catalog.xlsx`)

### Bước 3: Import dữ liệu
1. Nhấn nút **"More"** trong tab "RM1 Inventory"
2. Chọn **"Import Catalog (Standard Packing)"**
3. Chọn file Excel đã chuẩn bị
4. Đợi quá trình import hoàn tất
5. Nhận thông báo thành công

## ✅ Kết quả sau khi import
- Dữ liệu được lưu vào collection **`materials`** trong Firebase
- Cột "Standard Packing" sẽ hiển thị số đúng
- Không cần refresh trang - dữ liệu hiển thị ngay
- Console không còn báo lỗi về `standardPacking = 0`

## 🔧 Cấu trúc dữ liệu được hỗ trợ

### Tên cột linh hoạt:
- **Mã hàng**: `Mã hàng`, `materialCode`, `Mã`, `Code`
- **Tên hàng**: `Tên hàng`, `materialName`, `Tên`, `Name`
- **Đơn vị**: `Đơn vị`, `unit`, `Unit`
- **Standard Packing**: `Standard Packing`, `standardPacking`, `Số lượng đóng gói`
- **Nhà cung cấp**: `Nhà cung cấp`, `supplier`, `Supplier`
- **Danh mục**: `Danh mục`, `category`, `Category`

### Ví dụ dữ liệu:
```csv
Mã hàng,Tên hàng,Đơn vị,Standard Packing,Nhà cung cấp,Danh mục
B001003,Dây điện UL1571 28AWG màu đỏ,m,100,Supplier A,Cable
P0123,Plastic Bag 20x30cm,pcs,50,Supplier B,Packaging
B018694,Steel Wire 1.5mm,m,200,Supplier C,Metal
```

## ⚠️ Lưu ý quan trọng

1. **Standard Packing > 0**: Không được để giá trị 0
2. **Collection đích**: Dữ liệu được lưu vào `materials` (không phải `catalog`)
3. **Định dạng file**: Chỉ hỗ trợ `.xlsx` và `.xls`
4. **Quyền truy cập**: Cần có quyền import trong hệ thống
5. **Quota Firebase**: Đảm bảo không vượt quá giới hạn Firebase

## 🚨 Xử lý lỗi

### Lỗi "Quota exceeded":
- Firebase đã hết quota
- Kiểm tra Firebase Console → Usage and billing
- Đợi reset quota hoặc upgrade plan

### Lỗi import:
- Kiểm tra định dạng file Excel
- Đảm bảo có cột "Standard Packing" với giá trị > 0
- Kiểm tra console log để debug

### Standard Packing vẫn = 0:
- Đảm bảo đã import vào collection `materials`
- Kiểm tra giá trị trong file Excel
- Refresh trang sau khi import

## 📞 Hỗ trợ
Nếu gặp vấn đề:
1. Kiểm tra console log
2. Xem thông báo lỗi chi tiết
3. Đảm bảo file Excel có cấu trúc đúng
4. Kiểm tra quyền truy cập Firebase

---
**Lưu ý**: Chức năng này đã được tối ưu để import vào collection `materials` và tự động reload catalog cache, giúp cột "Standard Packing" hiển thị ngay lập tức sau khi import.
