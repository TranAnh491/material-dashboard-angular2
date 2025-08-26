# Cập Nhật Format QR Code - Thêm Thông Tin Ngày

## Thay Đổi

Đã cập nhật format QR code để bao gồm thông tin ngày nhập/ngày tạo.

### Format Cũ
```
Mã hàng|PO|Số đơn vị
```

### Format Mới
```
Mã hàng|PO|Số đơn vị|Ngày (DD/MM/YYYY)
```

## Ví Dụ

**Trước đây:**
```
B018694|PO123|100
```

**Bây giờ:**
```
B018694|PO123|100|26/08/2025
```

## Các Component Đã Được Cập Nhật

### 1. Inbound ASM1 Component
- **File:** `src/app/pages/inbound-asm1/inbound-asm1.component.ts`
- **Hàm:** `printQRCode()`
- **Thay đổi:** Thêm `material.importDate` vào QR code data

### 2. Materials ASM1 Component  
- **File:** `src/app/pages/materials-asm1/materials-asm1.component.ts`
- **Hàm:** `printQRCode()`
- **Thay đổi:** Thêm ngày nhập vào QR code data (sử dụng `importDate` nếu có)

### 3. RM1 Inventory - Thêm Cột Ngày Nhập
- **File:** `src/app/pages/materials-asm1/materials-asm1.component.html`
- **Thay đổi:** Thêm cột "Ngày nhập" sau cột "PO" để hiển thị ngày nhập của từng dòng inventory

### 4. Outbound ASM1 Component
- **File:** `src/app/pages/outbound-asm1/outbound-asm1.component.ts`
- **Thay đổi:** 
  - Cập nhật interface `OutboundMaterial` để lưu trữ `importDate`
  - Cập nhật hàm `onScanSuccess` để đọc ngày nhập từ QR code
  - Cập nhật hàm `createNewOutboundRecord` để lưu ngày nhập
  - Cập nhật hàm `updateInventoryExported` để so sánh chính xác theo ngày nhập
- **File:** `src/app/pages/outbound-asm1/outbound-asm1.component.html`
- **Thay đổi:** Thêm cột "Ngày nhập" sau cột "Số PO" để hiển thị ngày nhập từ QR code
- **File:** `src/app/pages/outbound-asm1/outbound-asm1.component.scss`
- **Thay đổi:** Thêm CSS styling cho cột ngày nhập

## Thông Tin Hiển Thị Trên Tem

Khi in tem QR, thông tin sẽ hiển thị:
- **Mã:** Mã hàng hóa
- **PO:** Purchase Order number
- **Ngày:** Ngày nhập/ngày tạo (từ QR code)
- **Số ĐV:** Số đơn vị (Rolls/Bags)

## Logic So Sánh Chính Xác Theo Ngày Nhập

### Vấn Đề Trước Đây
- Khi quét xuất, hệ thống chỉ so sánh theo `Material Code + PO`
- Có thể xuất nhầm từ dòng inventory khác ngày nhập
- Không chính xác trong việc tính toán tồn kho

### Giải Pháp Mới
- **QR Code mới:** Chứa thông tin ngày nhập
- **Outbound Scan:** Đọc được ngày nhập từ QR code
- **Inventory Update:** So sánh chính xác theo `Material Code + PO + Ngày nhập`
- **Kết quả:** Xuất đúng dòng inventory có cùng ngày nhập

### Quy Trình Hoạt Động
1. **Inbound:** Tạo QR code với ngày nhập
2. **Outbound Scan:** Quét QR code, đọc được ngày nhập
3. **Inventory Match:** Tìm dòng inventory có cùng Material + PO + Ngày nhập
4. **Update Chính Xác:** Cập nhật cột "Đã xuất" của đúng dòng inventory

## Lưu Ý

1. **Backward Compatibility:** QR code cũ vẫn có thể được scan (sẽ hiển thị ngày là undefined)
2. **Date Format:** Ngày được lưu theo format ISO (YYYY-MM-DD)
3. **Import Date:** Trong inbound, sử dụng `importDate` từ material
4. **Current Date:** Trong materials inventory, sử dụng `importDate` nếu có, nếu không thì dùng ngày hiện tại
5. **Precise Matching:** Outbound scan sẽ tìm chính xác dòng inventory có cùng ngày nhập

## Cách Sử Dụng

### Tạo QR Code Mới
- Tất cả QR code mới sẽ tự động có thông tin ngày nhập
- Không cần thay đổi gì trong quy trình làm việc

### Scan QR Code
- Hệ thống sẽ tự động đọc được thông tin ngày nhập từ QR code mới
- QR code cũ vẫn hoạt động bình thường

### So Sánh Chính Xác
- Khi quét xuất, hệ thống sẽ tìm đúng dòng inventory có cùng ngày nhập
- Đảm bảo tính toán tồn kho chính xác

## Kiểm Tra

Để kiểm tra QR code mới:
1. Tạo QR code từ inbound ASM1 hoặc materials ASM1
2. Scan QR code bằng ứng dụng scan
3. Kết quả sẽ hiển thị: `Mã hàng|PO|Số đơn vị|Ngày`
4. Khi quét xuất, hệ thống sẽ tìm chính xác dòng inventory có cùng ngày nhập
