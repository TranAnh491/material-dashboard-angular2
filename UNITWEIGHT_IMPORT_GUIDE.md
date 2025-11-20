# HƯỚNG DẪN IMPORT UNIT WEIGHT VÀO CATALOG

## Mục đích
Import trọng lượng đơn vị (unitWeight) cho từng material vào Firestore collection `materials` để tab **Utilization** tính toán đúng trọng lượng tổng trên mỗi vị trí.

---

## Công thức tính toán

```
Current Load (kg) = Stock (số lượng) × UnitWeight (gram) / 1000
```

**Ví dụ:**
- Material: B001003 (Dây điện)
- Stock: 100 (cuộn)
- UnitWeight: 5000g (mỗi cuộn nặng 5kg)
- **Current Load = 100 × 5000 / 1000 = 500 kg**

---

## Cách 1: Import từ File CSV (Khuyến nghị)

### Bước 1: Chuẩn bị file CSV

Sử dụng file template: **`catalog_unitweight_template.csv`**

**Cấu trúc file:**
```csv
materialCode,materialName,unit,unitWeight,standardPacking
B001003,Dây điện đồng 1.5mm,m,50,100
B017431,Dây điện nhôm 2.5mm,m,80,200
```

**Các cột:**
- `materialCode`: Mã material (bắt buộc, duy nhất)
- `materialName`: Tên material (bắt buộc)
- `unit`: Đơn vị (m, pcs, kg, etc.)
- `unitWeight`: **Trọng lượng 1 đơn vị tính bằng GRAM** ⭐
- `standardPacking`: Số lượng đóng gói chuẩn

### Bước 2: Điền dữ liệu

**Lưu ý quan trọng về unitWeight (gram):**

| Loại material | Đơn vị | unitWeight (gram) | Ví dụ |
|---------------|--------|-------------------|-------|
| Dây điện mỏng | m | 30-80g | Dây 1.5mm: 50g/m |
| Dây điện dày | m | 100-300g | Dây 6mm: 250g/m |
| Túi nhựa nhỏ | pcs | 2-10g | Túi PE: 5g/cái |
| Linh kiện nhỏ | pcs | 5-50g | Capacitor: 15g/cái |
| Motor nhỏ | pcs | 500-2000g | Motor 1/4HP: 1500g |
| Motor lớn | pcs | 3000-10000g | Motor 2HP: 8000g |

### Bước 3: Import vào Firebase

**Phương pháp A: Sử dụng Firebase Console**

1. Truy cập Firebase Console: https://console.firebase.google.com
2. Chọn project của bạn
3. Vào **Firestore Database**
4. Chọn collection **`materials`**
5. Click **Import** (hoặc thêm từng document thủ công)

**Phương pháp B: Sử dụng script (nếu có nhiều materials)**

Tạo file `import_unitweight.js` (Node.js):

```javascript
const admin = require('firebase-admin');
const csv = require('csv-parser');
const fs = require('fs');

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Import CSV
const materials = [];
fs.createReadStream('catalog_unitweight_template.csv')
  .pipe(csv())
  .on('data', (row) => {
    materials.push({
      materialCode: row.materialCode,
      materialName: row.materialName,
      unit: row.unit,
      unitWeight: parseInt(row.unitWeight),
      standardPacking: parseInt(row.standardPacking),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  })
  .on('end', async () => {
    console.log('📦 Importing', materials.length, 'materials...');
    
    for (const material of materials) {
      await db.collection('materials').doc(material.materialCode).set(material, { merge: true });
      console.log('✅ Imported:', material.materialCode);
    }
    
    console.log('🎉 Import completed!');
    process.exit(0);
  });
```

**Chạy script:**
```bash
npm install firebase-admin csv-parser
node import_unitweight.js
```

---

## Cách 2: Update thủ công trong Firebase Console

1. Vào Firebase Console → Firestore
2. Mở collection **`materials`**
3. Chọn document theo `materialCode`
4. Click **Edit**
5. Thêm field: `unitWeight` (type: **number**)
6. Nhập giá trị (đơn vị: **gram**)
7. Click **Update**

---

## Cách 3: Import từ Excel

### Bước 1: Tạo file Excel

| materialCode | materialName | unit | unitWeight | standardPacking |
|--------------|--------------|------|------------|-----------------|
| B001003 | Dây điện đồng 1.5mm | m | 50 | 100 |
| B017431 | Dây điện nhôm 2.5mm | m | 80 | 200 |

### Bước 2: Convert sang CSV

- File → Save As → CSV (Comma delimited)

### Bước 3: Import vào Firebase

- Theo hướng dẫn Cách 1

---

## Kiểm tra sau khi import

### 1. Kiểm tra trong Firebase Console

- Vào collection `materials`
- Chọn một document
- Xác nhận có field `unitWeight` (type: number)

### 2. Kiểm tra trong ứng dụng

1. Mở tab **Utilization**
2. Mở Console (F12)
3. Tìm log:
   ```
   ✅ Catalog loaded: XXX items
   📊 B001003 @ A01: 50 × 50g = 2.5kg
   ```
4. Kiểm tra cột **Current Load** có hiển thị số kg

### 3. Kiểm tra materials không có unitWeight

Console sẽ hiển thị warning:
```
⚠️ No unit weight for B999999, skipping...
```

→ Cần bổ sung unitWeight cho những materials này

---

## Ví dụ thực tế

### Dây điện (đơn vị: mét)

| Material | Mô tả | unitWeight (g/m) |
|----------|-------|------------------|
| B001003 | Dây 1.5mm² | 50 |
| B002004 | Dây 2.5mm² | 80 |
| B003005 | Dây 4mm² | 130 |
| B004006 | Dây 6mm² | 200 |

### Linh kiện điện tử (đơn vị: cái)

| Material | Mô tả | unitWeight (g/cái) |
|----------|-------|-------------------|
| C001001 | Capacitor 10uF | 5 |
| C002002 | Capacitor 100uF | 15 |
| R001001 | Relay 5V | 20 |
| R002002 | Relay 12V | 25 |

### Motor (đơn vị: cái)

| Material | Mô tả | unitWeight (g/cái) |
|----------|-------|-------------------|
| M001001 | Motor 1/4HP | 1500 |
| M002002 | Motor 1/2HP | 2500 |
| M003003 | Motor 1HP | 4000 |
| M004004 | Motor 2HP | 8000 |

---

## Lưu ý quan trọng

### ⚠️ Đơn vị phải là GRAM

- ❌ SAI: `unitWeight: 2.5` (kg)
- ✅ ĐÚNG: `unitWeight: 2500` (gram)

### 📊 Cách ước tính unitWeight nếu không có thông tin chính xác

1. **Tra catalog nhà cung cấp** (khuyến nghị)
2. **Cân thực tế** một mẫu
3. **Ước tính dựa trên loại material:**
   - Dây điện: 30-300g/m tùy tiết diện
   - Túi nhựa: 2-20g/cái tùy kích thước
   - Linh kiện nhỏ: 5-50g/cái
   - Motor: 500g-10kg/cái tùy công suất

### 🔄 Update định kỳ

- Khi có material mới → cập nhật unitWeight
- Khi nhà cung cấp thay đổi → update lại
- Định kỳ review các material có warning

---

## Hỗ trợ

Nếu gặp vấn đề:
1. Kiểm tra format file CSV (phải có header đúng)
2. Kiểm tra unitWeight phải là **số nguyên** (không có chữ, không âm)
3. Kiểm tra materialCode trùng với trong inventory-materials
4. Xem Console log để debug

---

## Tổng kết

✅ **Điền unitWeight (gram) cho tất cả materials**
✅ **Import vào Firestore collection `materials`**
✅ **Tab Utilization sẽ tự động tính Current Load (kg)**
✅ **Định kỳ cập nhật khi có material mới**

