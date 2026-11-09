# HƯỚNG DẪN SỬ DỤNG IMPORT CATALOG TRONG TAB UTILIZATION

## ✨ Tính năng mới

Tab **Utilization** đã có 2 nút mới:
1. **📥 Download Template** - Tải template Excel
2. **📤 Import Catalog** - Import unitWeight vào Firestore

---

## 🚀 Cách sử dụng (3 bước đơn giản)

### Bước 1: Tải Template
1. Vào tab **Utilization**
2. Click nút **"Download Template"** (màu xanh lá)
3. File Excel sẽ được tải về máy

### Bước 2: Điền dữ liệu
1. Mở file Excel vừa tải
2. Xem sheet **"Hướng dẫn"** để đọc chi tiết
3. Chuyển sang sheet **"Catalog UnitWeight"**
4. Điền thông tin materials:

| Cột | Bắt buộc | Mô tả | Ví dụ |
|-----|----------|-------|-------|
| materialCode | ✅ Có | Mã material | B001003 |
| materialName | ✅ Có | Tên material | Dây điện 1.5mm |
| unit | Không | Đơn vị | m |
| **unitWeight** | ✅ Có | **Trọng lượng 1 đơn vị (GRAM)** | **50** |
| standardPacking | Không | Số lượng đóng gói | 100 |
| category | Không | Danh mục | Dây điện |
| supplier | Không | Nhà cung cấp | ABC Electric |

**⚠️ LƯU Ý: `unitWeight` phải tính bằng GRAM**

### Bước 3: Import vào hệ thống
1. Lưu file Excel
2. Quay lại tab **Utilization**
3. Click nút **"Import Catalog"** (màu cam)
4. Chọn file Excel vừa lưu
5. Xác nhận import
6. Đợi hệ thống xử lý
7. Xem kết quả trong popup

---

## 📊 Ví dụ unitWeight (GRAM)

### Dây điện (gram/mét)
- Dây 1.5mm²: **50g/m**
- Dây 2.5mm²: **80g/m**
- Dây 4mm²: **130g/m**
- Dây 6mm²: **200g/m**

### Linh kiện (gram/cái)
- Capacitor 10uF: **5g**
- Capacitor 100uF: **15g**
- Relay 5V: **20g**
- Relay 12V: **25g**

### Motor (gram/cái)
- Motor 1/4HP: **1500g** (1.5kg)
- Motor 1/2HP: **2500g** (2.5kg)
- Motor 1HP: **4000g** (4kg)
- Motor 2HP: **8000g** (8kg)

### Túi nhựa (gram/cái)
- Túi PE 20×30: **5g**
- Túi PE 30×40: **10g**
- Túi PE 40×60: **20g**

---

## 🔍 Kiểm tra sau khi Import

### 1. Xem kết quả ngay lập tức
Sau khi import, popup sẽ hiển thị:
```
📊 Kết quả import:

✅ Thành công: 25 materials
❌ Lỗi: 2 materials

Lỗi:
M999999: Invalid unitWeight (abc)
P888888: Missing materialCode
```

### 2. Kiểm tra trong tab Utilization
- Cột **Current Load** sẽ hiển thị số kg
- Dữ liệu tự động cập nhật

### 3. Kiểm tra trong Console (F12)
Mở Console để xem chi tiết:
```
✅ Imported: B001003 = 50g
✅ Imported: M001234 = 2500g
📊 B001003 @ A01: 100 × 50g = 5kg
📊 Total weight across all positions: 1250.5 kg
```

---

## ⚠️ Lưu ý quan trọng

### 1. Định dạng file
- ✅ Chấp nhận: `.xlsx`, `.xls`, `.csv`
- ❌ Không chấp nhận: `.txt`, `.pdf`, `.doc`

### 2. Đơn vị unitWeight
- ✅ ĐÚNG: `unitWeight: 2500` (gram)
- ❌ SAI: `unitWeight: 2.5` (kg)

### 3. materialCode
- Phải trùng với mã trong tab Materials ASM1
- Phải duy nhất (không trùng lặp)

### 4. Dữ liệu bắt buộc
- `materialCode`: Không được để trống
- `unitWeight`: Phải là số > 0

---

## 🔄 Công thức tính

```
Current Load (kg) = Stock × UnitWeight (gram) / 1000
```

**Ví dụ:**
- Material: B001003 (Dây điện)
- Stock: 100 cuộn
- UnitWeight: 50g/cuộn
- **Current Load = 100 × 50 / 1000 = 5 kg**

---

## ❓ Xử lý lỗi

### Lỗi: "Invalid unitWeight"
**Nguyên nhân:** unitWeight không phải là số hoặc ≤ 0
**Giải pháp:** Kiểm tra lại cột unitWeight, phải là số nguyên dương

### Lỗi: "Missing materialCode"
**Nguyên nhân:** Cột materialCode để trống
**Giải pháp:** Điền đầy đủ materialCode cho tất cả các dòng

### Lỗi: "File không có dữ liệu"
**Nguyên nhân:** Sheet Excel trống hoặc không có header
**Giải pháp:** Sử dụng template đúng định dạng

### Lỗi: "Thiếu cột bắt buộc"
**Nguyên nhân:** File không có cột materialCode hoặc unitWeight
**Giải pháp:** Download lại template và điền đúng format

---

## 💡 Tips

1. **Backup dữ liệu trước khi import**
   - Export dữ liệu hiện tại từ Firebase (nếu cần)

2. **Import từng đợt nhỏ**
   - Nếu có nhiều materials, chia thành nhiều file nhỏ
   - Dễ kiểm soát và xử lý lỗi

3. **Kiểm tra trước khi import**
   - Đảm bảo unitWeight đã đúng
   - Kiểm tra materialCode có tồn tại trong hệ thống

4. **Cập nhật định kỳ**
   - Khi có material mới
   - Khi nhà cung cấp thay đổi specs

---

## 📞 Hỗ trợ

Nếu gặp vấn đề:
1. Kiểm tra Console (F12) để xem log chi tiết
2. Xem lại file template có đúng format không
3. Đảm bảo unitWeight là số nguyên (gram)
4. Kiểm tra kết nối Firebase

---

**Chúc bạn sử dụng thành công! 🎉**

