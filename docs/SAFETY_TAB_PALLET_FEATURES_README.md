# 🚀 Tính năng mới: Quản lý Pallet trong Tab Safety

## ✨ Các cột mới đã được thêm

### 1. **Cột Tên hàng**
- **Vị trí:** Cạnh cột Mã hàng
- **Chức năng:** Nhập tay tên hàng hóa
- **Cách sử dụng:** Click vào input để nhập tên hàng
- **Lưu ý:** Tên hàng sẽ được lưu lại và hiển thị trong báo cáo

### 2. **Cột Lượng Pallet ASM1**
- **Vị trí:** Cạnh cột Lượng ASM1
- **Chức năng:** Nhập tay số lượng trên mỗi pallet cho ASM1
- **Cách sử dụng:** Click vào input để nhập số lượng/pallet
- **Ví dụ:** Nếu mỗi pallet chứa 50 sản phẩm, nhập 50

### 3. **Cột Pallet ASM1**
- **Vị trí:** Cạnh cột Lượng Pallet ASM1
- **Chức năng:** Tự động tính số pallet cần thiết cho ASM1
- **Công thức:** `Số Pallet = Lượng ASM1 ÷ Lượng Pallet ASM1` (làm tròn lên)
- **Ví dụ:** Lượng ASM1 = 150, Lượng Pallet = 50 → Số Pallet = 3

### 4. **Cột Lượng Pallet ASM2**
- **Vị trí:** Cạnh cột Lượng ASM2
- **Chức năng:** Nhập tay số lượng trên mỗi pallet cho ASM2
- **Cách sử dụng:** Click vào input để nhập số lượng/pallet
- **Ví dụ:** Nếu mỗi pallet chứa 40 sản phẩm, nhập 40

### 5. **Cột Pallet ASM2**
- **Vị trí:** Cạnh cột Lượng Pallet ASM2
- **Chức năng:** Tự động tính số pallet cần thiết cho ASM2
- **Công thức:** `Số Pallet = Lượng ASM2 ÷ Lượng Pallet ASM2` (làm tròn lên)
- **Ví dụ:** Lượng ASM2 = 200, Lượng Pallet = 40 → Số Pallet = 5

### 6. **Cột Tổng Pallet**
- **Vị trí:** Cạnh cột Tổng
- **Chức năng:** Tự động tính tổng số pallet cần thiết
- **Công thức:** `Tổng Pallet = Pallet ASM1 + Pallet ASM2`
- **Ví dụ:** Pallet ASM1 = 3, Pallet ASM2 = 5 → Tổng Pallet = 8

## 🔄 Cách hoạt động

### Khi scan ASM1 hoặc ASM2:
1. **Cập nhật số lượng:** Số lượng được cộng dồn vào dòng có sẵn
2. **Tự động tính pallet:** Nếu đã có "Lượng Pallet", hệ thống tự động tính lại "Số Pallet"
3. **Cập nhật tổng:** Tổng số lượng và tổng số pallet được cập nhật

### Khi nhập tay "Lượng Pallet":
1. **Nhập giá trị:** Click vào input "Lượng Pallet" để nhập số lượng/pallet
2. **Tự động tính:** Hệ thống tự động tính "Số Pallet" = Lượng ÷ Lượng Pallet
3. **Cập nhật tổng:** Tổng số pallet được cập nhật

## 📊 Ví dụ thực tế

### Material: B018694
- **Lượng ASM1:** 150 sản phẩm
- **Lượng Pallet ASM1:** 50 sản phẩm/pallet
- **Pallet ASM1:** 3 pallet (150 ÷ 50 = 3)
- **Lượng ASM2:** 100 sản phẩm
- **Lượng Pallet ASM2:** 25 sản phẩm/pallet
- **Pallet ASM2:** 4 pallet (100 ÷ 25 = 4)
- **Tổng Pallet:** 7 pallet (3 + 4)

## 🎯 Lợi ích

### 1. **Quản lý kho hiệu quả:**
- Biết chính xác số pallet cần thiết
- Lập kế hoạch vận chuyển và lưu trữ
- Tối ưu hóa không gian kho

### 2. **Báo cáo chi tiết:**
- Export Excel bao gồm tất cả thông tin pallet
- Theo dõi số lượng và số pallet riêng biệt cho ASM1/ASM2
- Phân tích hiệu suất sử dụng pallet

### 3. **Tính toán tự động:**
- Không cần tính tay số pallet
- Cập nhật real-time khi thay đổi số lượng
- Đảm bảo tính chính xác

## 🚨 Lưu ý quan trọng

### 1. **Thứ tự nhập liệu:**
- Có thể nhập "Lượng Pallet" trước hoặc sau khi scan
- Hệ thống sẽ tự động tính lại "Số Pallet" khi có thay đổi

### 2. **Làm tròn lên:**
- Số pallet luôn được làm tròn lên để đảm bảo đủ chỗ chứa
- Ví dụ: 151 sản phẩm ÷ 50 sản phẩm/pallet = 3.02 → 4 pallet

### 3. **Dữ liệu mới:**
- Các material mới scan sẽ có "Lượng Pallet" = 0
- Cần nhập tay "Lượng Pallet" để tính "Số Pallet"

## 🔧 Cách sử dụng

### 1. **Nhập tên hàng:**
```
Click vào cột "Tên hàng" → Nhập tên → Enter
```

### 2. **Nhập lượng pallet ASM1:**
```
Click vào cột "Lượng Pallet ASM1" → Nhập số lượng/pallet → Enter
```

### 3. **Nhập lượng pallet ASM2:**
```
Click vào cột "Lượng Pallet ASM2" → Nhập số lượng/pallet → Enter
```

### 4. **Xem kết quả:**
- Cột "Pallet ASM1" và "Pallet ASM2" sẽ tự động hiển thị số pallet
- Cột "Tổng Pallet" sẽ hiển thị tổng số pallet cần thiết

## 📈 Export Excel

Khi export Excel, báo cáo sẽ bao gồm:
- Tên hàng
- Lượng ASM1/ASM2
- Lượng Pallet ASM1/ASM2
- Số Pallet ASM1/ASM2
- Tổng số lượng
- Tổng số pallet
- Safety Level
- Tình trạng tồn kho

## 🎉 Kết quả mong đợi

Sau khi áp dụng các tính năng mới:
- ✅ Quản lý pallet hiệu quả hơn
- ✅ Tính toán số pallet tự động và chính xác
- ✅ Báo cáo chi tiết và đầy đủ thông tin
- ✅ Dễ dàng lập kế hoạch vận chuyển và lưu trữ
- ✅ Tối ưu hóa không gian kho
