# Test Format Ngày Tháng

## Vấn Đề Đã Phát Hiện

**QR Code format:** `B008018|KZPO0425/0015|5|2025-08-26`
- Ngày nhập: `2025-08-26` (YYYY-MM-DD)

**Vấn đề có thể:**
1. **Format ngày trong inventory khác với QR code**
2. **Logic so sánh ngày không xử lý đúng các format khác nhau**

## Các Format Ngày Có Thể Gặp

### 1. **QR Code (String)**
```
2025-08-26
```

### 2. **Database (Firebase Timestamp)**
```typescript
Timestamp { seconds: 1735689600, nanoseconds: 0 }
```

### 3. **Database (Date Object)**
```typescript
Date: 2025-08-26T00:00:00.000Z
```

### 4. **Database (String - DD/MM/YYYY)**
```
26/08/2025
```

## Giải Pháp Đã Áp Dụng

### ✅ **Logic So Sánh Ngày Mới**
```typescript
// Xử lý các format ngày khác nhau
if (docImportDate.toDate) {
  // Firebase Timestamp
  docDate = docImportDate.toDate().toISOString().split('T')[0];
} else if (docImportDate instanceof Date) {
  // Date object
  docDate = docImportDate.toISOString().split('T')[0];
} else if (typeof docImportDate === 'string') {
  // String date
  if (docImportDate.includes('-')) {
    // Format "2025-08-26"
    docDate = docImportDate;
  } else if (docImportDate.includes('/')) {
    // Format "26/08/2025" - convert sang "2025-08-26"
    const parts = docImportDate.split('/');
    if (parts.length === 3) {
      docDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
  }
}
```

## Cách Test

### 1. **Tạo QR Code**
- Inbound ASM1: Tạo QR code với ngày nhập
- Format: `Mã hàng|PO|Số đơn vị|Ngày nhập`

### 2. **Quét QR Code**
- Outbound ASM1: Quét QR code
- Kiểm tra console log để xem:
  - Import date từ QR: `2025-08-26`
  - Import date type: `string`
  - Import date length: `10`

### 3. **Kiểm Tra Database**
- Xem `importDate` trong collection `outbound-materials`
- So sánh format với ngày trong `inventory-materials`

### 4. **Kiểm Tra Cột "Ngày nhập"**
- Cột "Ngày nhập" trong tab outbound phải hiển thị: `26/08/2025`

## Debug Logs

Khi quét QR code, console sẽ hiển thị:
```
📅 Import date from QR: 2025-08-26
📅 Import date type: string
📅 Import date length: 10
🔍 Tìm inventory record với ngày nhập: 2025-08-26
🔍 Lọc X inventory records theo ngày nhập: 2025-08-26
  📅 Record ABC123: importDate = [giá trị từ database]
    - Doc date: 2025-08-26, Import date: 2025-08-26, Match: true
    - Original docImportDate type: [type], value: [giá trị]
```

## Kết Quả Mong Đợi

✅ **QR Code được parse đúng**
✅ **Ngày nhập được lưu vào database**
✅ **Cột "Ngày nhập" hiển thị dữ liệu**
✅ **Logic so sánh ngày hoạt động chính xác**
✅ **Inventory được cập nhật đúng dòng có cùng ngày nhập**
