# Warehouse Loading - Báo cáo sử dụng không gian kho

## 📊 Mô tả

Tab "Loading" (Warehouse Loading) cho phép xem báo cáo chi tiết về việc sử dụng không gian kho cho từng nhà máy (ASM1 hoặc ASM2).

## ✨ Tính năng

### 1. **Chọn nhà máy**
- Màn hình đầu tiên cho phép chọn ASM1 hoặc ASM2
- Giao diện đẹp mắt với animation

### 2. **Thống kê tổng quan**
- **Tổng số mã hàng**: Số lượng materials trong kho
- **Vị trí đang sử dụng**: Số vị trí có hàng
- **Vị trí còn trống**: Số vị trí chưa sử dụng (ước tính)
- **Tỷ lệ sử dụng**: % không gian kho đang được sử dụng

### 3. **Biểu đồ sử dụng không gian**
- Progress bar hiển thị tỷ lệ sử dụng
- Mã màu theo mức độ:
  - 🔴 < 50%: Còn nhiều chỗ trống
  - 🟠 50-80%: Mức sử dụng trung bình
  - 🟢 > 80%: Sử dụng tốt không gian

### 4. **Top 20 vị trí**
- Biểu đồ cột (bar chart) hiển thị 20 vị trí có nhiều mã hàng nhất
- Giúp dễ dàng identify các vị trí "hot"

### 5. **Bảng chi tiết**
- Danh sách đầy đủ tất cả các vị trí
- Thông tin:
  - Vị trí
  - Số lượng mã hàng tại vị trí đó
  - Tổng số lượng (quantity)
  - Danh sách mã hàng

### 6. **Export Excel**
- Export toàn bộ dữ liệu ra file Excel
- Format: `Warehouse_Loading_ASM1_2025-01-XX.xlsx`

## 🔄 Cách sử dụng

1. **Vào tab Loading** từ menu sidebar
2. **Chọn nhà máy** (ASM1 hoặc ASM2)
3. **Xem báo cáo** với đồ họa và bảng chi tiết
4. **Export** nếu cần lưu báo cáo

## 📦 Dữ liệu nguồn

- Collection: `inventory-materials`
- Filter: `factory == 'ASM1'` hoặc `factory == 'ASM2'`
- Tính toán dựa trên:
  - `location`: Vị trí kho
  - `materialCode`: Mã hàng
  - `quantity`: Số lượng

## 🎨 Giao diện

- **Màn hình chọn factory**: Gradient background đẹp mắt
- **Báo cáo**: Cards thống kê màu sắc
- **Biểu đồ**: Animation mượt mà
- **Responsive**: Hoạt động tốt trên mobile

## 🔧 Cấu hình

Để thay đổi ước tính tổng số vị trí kho, sửa function `estimateTotalLocations()` trong file `.ts`:

```typescript
private estimateTotalLocations(usedLocations: number): number {
  // Customize based on actual warehouse capacity
  const estimatedTotal = Math.max(usedLocations * 1.5, usedLocations + 50);
  return Math.ceil(estimatedTotal);
}
```

## 🚀 Tính năng có thể mở rộng

- [ ] Thêm filter theo khu vực (T1, T2, etc.)
- [ ] Thêm time range để xem historical data
- [ ] Thêm heatmap visualization
- [ ] Thêm capacity planning recommendations
- [ ] Thêm alerts khi vị trí quá tải
- [ ] Thêm comparison giữa ASM1 và ASM2

## 📝 Notes

- Tổng số vị trí hiện tại là **ước tính** (150% của số vị trí đang dùng)
- Có thể cấu hình lại công thức tính hoặc set fixed number
- Dữ liệu realtime từ Firebase Firestore

