# Hướng Dẫn Debug Cột "Ngày Nhập" Không Hiển Thị

## 🔍 **Bước 1: Kiểm Tra Console Log Khi Scan QR Code**

Sau khi scan QR code `B008018|KZPO0425/0015|5|2025-08-26`, console sẽ hiển thị:

```
✅ Parsed QR data (pipe format): {
  materialCode: "B008018",
  poNumber: "KZPO0425/0015", 
  quantity: 5,
  importDate: "2025-08-26"
}
📅 Import date from QR: 2025-08-26
📅 Import date type: string
📅 Import date length: 10
```

**Nếu không thấy `importDate`, vấn đề ở parsing QR code**

## 🔍 **Bước 2: Kiểm Tra Khi Tạo Outbound Record**

Console sẽ hiển thị:

```
📝 Creating new outbound record: {
  ...,
  importDate: "2025-08-26"
}
📅 Import date in outbound record: 2025-08-26
📅 Import date type in outbound record: string
🔥 Adding to Firebase collection: outbound-materials
✅ New outbound record created with ID: [ID]
📅 Saved importDate in database: 2025-08-26
📅 Saved importDate type in database: string
```

**Nếu không thấy importDate ở đây, vấn đề ở việc tạo record**

## 🔍 **Bước 3: Kiểm Tra Khi Load Materials**

Console sẽ hiển thị:

```
📦 Processing doc [ID], factory: ASM1
📅 Doc [ID] importDate: 2025-08-26
📅 Doc [ID] importDate type: string
📅 Mapped material importDate: 2025-08-26
```

**Nếu không thấy importDate ở đây, vấn đề ở việc load từ database**

## 🔍 **Bước 4: Kiểm Tra HTML Template**

Trong file `outbound-asm1.component.html`, cột "Ngày nhập" phải có:

```html
<td class="import-date-cell">
  {{material.importDate ? (material.importDate | date:'dd/MM/yyyy') : 'N/A'}}
</td>
```

## 🚨 **Các Vấn Đề Có Thể Gặp:**

### 1. **QR Code Không Được Parse Đúng**
- Kiểm tra format: `Mã hàng|PO|Số đơn vị|Ngày nhập`
- Đảm bảo có đủ 4 phần

### 2. **Dữ Liệu Không Được Lưu Vào Database**
- Kiểm tra console log khi tạo record
- Xem có lỗi gì khi save không

### 3. **Dữ Liệu Không Được Load Từ Database**
- Kiểm tra console log khi load materials
- Xem có filter gì loại bỏ importDate không

### 4. **HTML Template Không Hiển Thị**
- Kiểm tra cột "Ngày nhập" có đúng syntax không
- Kiểm tra CSS có ẩn cột không

## 🧪 **Test Đơn Giản:**

1. **Scan QR code** và xem console log
2. **Refresh trang** outbound để xem có load lại dữ liệu không
3. **Kiểm tra database** trực tiếp trong Firebase Console
4. **Kiểm tra HTML** có hiển thị cột "Ngày nhập" không

## 📋 **Kết Quả Mong Đợi:**

✅ **Console hiển thị đầy đủ thông tin importDate**
✅ **Database lưu trữ importDate đúng**
✅ **Cột "Ngày nhập" hiển thị: 26/08/2025**

Hãy chạy test và cho tôi biết console log hiển thị gì ở mỗi bước!
