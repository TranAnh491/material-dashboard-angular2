# HƯỚNG DẪN NHANH: Import Unit Weight

## 🎯 Mục tiêu
Import trọng lượng đơn vị (unitWeight) để tab **Utilization** tính đúng Current Load.

## ⚡ Cách nhanh nhất

### Bước 1: Mở file template
Mở file: **`catalog_unitweight_template.csv`** bằng Excel hoặc Google Sheets

### Bước 2: Điền dữ liệu

| materialCode | materialName | unit | **unitWeight** | standardPacking |
|--------------|--------------|------|----------------|-----------------|
| B001003 | Dây điện 1.5mm | m | **50** | 100 |
| B017431 | Dây điện 2.5mm | m | **80** | 200 |

**⚠️ LƯU Ý: `unitWeight` phải tính bằng GRAM**

### Bước 3: Import vào Firebase

**Cách 1: Firebase Console (thủ công)**
1. Vào https://console.firebase.google.com
2. Chọn Firestore Database
3. Mở collection **`materials`**
4. Với mỗi material:
   - Tìm document theo `materialCode`
   - Thêm field `unitWeight` (type: **number**)
   - Nhập giá trị (đơn vị: gram)

**Cách 2: Import CSV (nếu nhiều materials)**
- Xem file: `UNITWEIGHT_IMPORT_GUIDE.md` (hướng dẫn chi tiết)

---

## 📊 Ví dụ unitWeight (đơn vị: GRAM)

### Dây điện (g/mét)
- Dây 1.5mm²: **50g**
- Dây 2.5mm²: **80g**
- Dây 4mm²: **130g**
- Dây 6mm²: **200g**

### Linh kiện (g/cái)
- Capacitor nhỏ: **5-15g**
- Relay: **20-30g**
- Contactor: **50-100g**

### Motor (g/cái)
- Motor 1/4HP: **1500g** (1.5kg)
- Motor 1/2HP: **2500g** (2.5kg)
- Motor 1HP: **4000g** (4kg)
- Motor 2HP: **8000g** (8kg)

### Túi nhựa (g/cái)
- Túi PE nhỏ 20×30: **5g**
- Túi PE trung 30×40: **10g**
- Túi PE lớn 40×60: **20g**

---

## ✅ Kiểm tra

Sau khi import:
1. Mở tab **Utilization**
2. Mở Console (F12)
3. Xem log:
   ```
   ✅ Catalog loaded: 100 items
   📊 B001003 @ A01: 50 × 50g = 2.5kg
   ```
4. Cột **Current Load** hiển thị số kg

---

## ❓ Câu hỏi thường gặp

**Q: Không biết trọng lượng chính xác?**
- Tra catalog nhà cung cấp
- Hoặc cân thực tế 1 mẫu
- Hoặc ước tính theo bảng trên

**Q: Đơn vị là gì?**
- **GRAM** (không phải kg)
- 1kg = 1000 gram

**Q: Materials nào cần import?**
- TẤT CẢ materials trong tab Materials ASM1
- Nếu thiếu → Console sẽ warning

**Q: Cần import lại khi nào?**
- Khi có material mới
- Khi nhà cung cấp thay đổi specs

---

## 📁 Files liên quan

- `catalog_unitweight_template.csv` - Template CSV
- `catalog_unitweight_template.json` - Template JSON
- `UNITWEIGHT_IMPORT_GUIDE.md` - Hướng dẫn chi tiết

