# HƯỚNG DẪN IMPORT CATALOG VỚI STANDARD PACKING

## Vấn đề hiện tại
- Cột "Standard Packing" trong tab "RM1 Inventory" không hiển thị số
- Giá trị `standardPacking` trong database hiện tại là `0` (không đúng)
- Cần cập nhật giá trị thực tế cho từng material

## Giải pháp
Import lại dữ liệu catalog với giá trị `standardPacking` đúng vào collection `materials` trong Firebase.

## Các file template có sẵn
1. **`catalog_import_template.csv`** - File CSV để chỉnh sửa dễ dàng
2. **`catalog_import_template.json`** - File JSON để import trực tiếp
3. **`catalog_import_template.xlsx`** - Hướng dẫn tạo file Excel

## Cách thực hiện

### Phương pháp 1: Sử dụng file CSV
1. Mở file `catalog_import_template.csv` trong Excel hoặc Google Sheets
2. Cập nhật giá trị `standardPacking` cho từng material:
   - **B001003**: Thay `100` bằng số mét thực tế trong 1 package (ví dụ: 100, 200, 500)
   - **P0123**: Thay `50` bằng số túi thực tế trong 1 package
   - **B018694**: Thay `200` bằng số mét thực tế trong 1 package
3. Lưu file với tên mới (ví dụ: `updated_catalog.csv`)
4. Import vào Firebase collection `materials`

### Phương pháp 2: Sử dụng file JSON
1. Mở file `catalog_import_template.json`
2. Cập nhật giá trị `standardPacking` cho từng material
3. Lưu file
4. Import trực tiếp vào Firebase collection `materials`

### Phương pháp 3: Tạo file Excel mới
1. Tạo file Excel mới với các cột:
   - **A**: materialCode (Mã vật liệu)
   - **B**: materialName (Tên vật liệu)
   - **C**: unit (Đơn vị)
   - **D**: standardPacking (Số lượng đóng gói tiêu chuẩn) ⭐ **QUAN TRỌNG**
   - **E**: supplier (Nhà cung cấp - tùy chọn)
   - **F**: category (Danh mục - tùy chọn)

2. Điền dữ liệu thực tế:
   - `materialCode`: Mã duy nhất cho mỗi material
   - `materialName`: Tên mô tả đầy đủ
   - `unit`: Đơn vị đo (m, pcs, kg, etc.)
   - `standardPacking`: **Số lượng thực tế trong 1 package** (KHÔNG được để 0)
   - `supplier`: Tên nhà cung cấp (nếu có)
   - `category`: Danh mục vật liệu (nếu có)

## Ví dụ giá trị standardPacking
- **Dây điện**: 100m, 200m, 500m (tùy theo package)
- **Túi nhựa**: 50 cái, 100 cái, 200 cái
- **Linh kiện điện tử**: 100 cái, 1000 cái
- **Motor**: 1 cái (thường đóng gói riêng lẻ)

## Lưu ý quan trọng
1. **KHÔNG để `standardPacking = 0`** - đây là nguyên nhân gây ra vấn đề
2. Giá trị phải phản ánh **số lượng thực tế** trong 1 package
3. Nếu không biết chính xác, hãy ước tính dựa trên thông tin nhà cung cấp
4. Sau khi import, cột "Standard Packing" sẽ hiển thị số đúng

## Kiểm tra sau khi import
1. Vào tab "RM1 Inventory"
2. Cột "Standard Packing" sẽ hiển thị số thay vì để trống
3. Console sẽ không còn báo lỗi về `standardPacking = 0`

## Hỗ trợ
Nếu gặp vấn đề trong quá trình import, hãy kiểm tra:
- Định dạng file (CSV, JSON, Excel)
- Cấu trúc dữ liệu (tên cột, kiểu dữ liệu)
- Quyền truy cập Firebase
- Console log để debug

---
**Lưu ý**: Đây là bước cần thiết để khắc phục vấn đề hiển thị Standard Packing. Code đã được sửa để load dữ liệu đúng cách, chỉ cần cập nhật dữ liệu trong database.
