# 🔐 Access Control System - Hệ thống Phân quyền

## 📋 Tổng quan

Hệ thống phân quyền mới đã được cải tiến để giải quyết vấn đề user chỉ được cấp quyền xem RM1 (ASM1) mà vẫn thấy được RM2 (ASM2).

## 🚨 Vấn đề cũ

**Trước đây:**
- `TabPermissionService` tự động cấp quyền truy cập **TẤT CẢ** tabs khi user không có permissions được cấu hình
- `FactoryAccessService` mặc định cho phép truy cập tất cả nhà máy khi không có factory setting
- Logic lọc routes không chính xác

**Kết quả:** User chỉ được cấp quyền ASM1 nhưng vẫn thấy được ASM2 trong sidebar

## ✅ Giải pháp mới

### 1. **TabPermissionService** - Không còn default permissions quá rộng
```typescript
// TRƯỚC: Tự động cấp quyền tất cả tabs
'inbound-asm1': true,
'inbound-asm2': true,  // ← VẤN ĐỀ!

// SAU: Dựa trên factory access
'inbound-asm1': factoryAccess.canAccessASM1,
'inbound-asm2': factoryAccess.canAccessASM2,  // ← Chỉ true nếu có quyền ASM2
```

### 2. **FactoryAccessService** - Mặc định KHÔNG cho phép truy cập
```typescript
// TRƯỚC: Mặc định cho phép tất cả
canAccessASM1: true,
canAccessASM2: true,

// SAU: Mặc định KHÔNG cho phép
canAccessASM1: false,
canAccessASM2: false,
```

### 3. **AccessControlService** - Service mới kiểm soát tổng hợp
- Kết hợp cả tab permissions và factory access
- Logic kiểm tra quyền truy cập chính xác
- Dễ dàng mở rộng và bảo trì

### 4. **FilteredRoutesService** - Lọc routes chính xác
- Sử dụng AccessControlService để kiểm tra quyền
- Chỉ hiển thị tabs mà user thực sự có quyền truy cập

## 🔧 Cách hoạt động

### **Bước 1: User đăng nhập**
```typescript
// Hệ thống kiểm tra:
1. Tab permissions từ Firebase
2. Factory access từ user settings
3. Role của user
```

### **Bước 2: Tạo permissions**
```typescript
// Nếu user có permissions được cấu hình:
// → Sử dụng permissions đó

// Nếu không có:
// → Tạo permissions dựa trên factory access
// → User chỉ thấy tabs tương ứng với nhà máy được phép
```

### **Bước 3: Lọc sidebar**
```typescript
// Chỉ hiển thị routes mà user có quyền truy cập
// Ví dụ: User chỉ có quyền ASM1
// → Chỉ thấy: RM1 Inbound, RM1 Outbound, RM1 Inventory
// → KHÔNG thấy: RM2 Inbound, RM2 Outbound, RM2 Inventory
```

## 📊 Ví dụ cụ thể

### **User A - Chỉ được cấp quyền ASM1**
```typescript
// Factory setting: "ASM1"
// Kết quả:
canAccessASM1: true,
canAccessASM2: false,

// Sidebar sẽ hiển thị:
✅ Dashboard
✅ RM1 Inbound (inbound-asm1)
❌ RM2 Inbound (inbound-asm2) - KHÔNG HIỂN THỊ
✅ RM1 Outbound (outbound-asm1)
❌ RM2 Outbound (outbound-asm2) - KHÔNG HIỂN THỊ
✅ RM1 Inventory (materials-asm1)
❌ RM2 Inventory (materials-asm2) - KHÔNG HIỂN THỊ
```

### **User B - Được cấp quyền cả ASM1 và ASM2**
```typescript
// Factory setting: "ALL"
// Kết quả:
canAccessASM1: true,
canAccessASM2: true,

// Sidebar sẽ hiển thị:
✅ Dashboard
✅ RM1 Inbound (inbound-asm1)
✅ RM2 Inbound (inbound-asm2)
✅ RM1 Outbound (outbound-asm1)
✅ RM2 Outbound (outbound-asm2)
✅ RM1 Inventory (materials-asm1)
✅ RM2 Inventory (materials-asm2)
```

## 🛠️ Cách cấu hình

### **1. Trong Settings > Users**
- Chọn user cần cấu hình
- Chọn "Nhà máy": ASM1, ASM2, hoặc Tất cả
- Lưu thay đổi

### **2. Trong Settings > Tab Permissions (nếu cần)**
- Có thể cấu hình chi tiết từng tab
- Override factory access nếu cần thiết

## 🧪 Testing

### **Access Test Component**
```typescript
// Component để test quyền truy cập
// Hiển thị:
- Tab permissions hiện tại
- Factory access
- Kết quả kiểm tra quyền truy cập từng tab
```

## 🔒 Bảo mật

### **Route Guards**
- `TabPermissionGuard` kiểm tra quyền truy cập trước khi cho phép vào route
- Nếu không có quyền → Redirect về Dashboard

### **Sidebar Filtering**
- Chỉ hiển thị menu items mà user có quyền truy cập
- Không thể truy cập trực tiếp URL nếu không có quyền

## 📝 Lưu ý quan trọng

1. **User mới** sẽ KHÔNG thấy bất kỳ tab nhà máy nào cho đến khi được cấu hình
2. **Admin/Quản lý** luôn có quyền truy cập tất cả nhà máy
3. **Permissions** được cache và update real-time
4. **Factory access** có priority cao hơn tab permissions

## 🚀 Kết quả mong đợi

✅ User chỉ thấy tabs tương ứng với nhà máy được phép  
✅ Không còn hiện tượng "thấy được RM2 khi chỉ có quyền RM1"  
✅ Hệ thống phân quyền minh bạch và dễ quản lý  
✅ Bảo mật được đảm bảo ở cả frontend và backend
