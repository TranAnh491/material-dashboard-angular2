# Hướng dẫn cập nhật hiển thị tài khoản và CSS

## Mục đích
Cập nhật logic hiển thị tài khoản để:
1. **Email bắt đầu bằng "asp"** (như `asp2197@asp.com`) chỉ hiển thị `ASP2197` (không tự tạo mail)
2. **Mở rộng cột tên** để hiển thị hết tên mà không bị xuống dòng

## Những thay đổi đã thực hiện

### 1. Cập nhật logic hiển thị tài khoản

#### **File:** `src/app/pages/settings/settings.component.ts`

**Method `getAccountDisplay()`:**
```typescript
getAccountDisplay(user: any): string {
  if (user.uid === 'special-steve-uid') {
    return '👑 ' + (user.displayName || user.email);
  }
  
  // Nếu có employeeId, hiển thị mã nhân viên ASP
  if (user.employeeId) {
    const displayName = user.displayName ? ` - ${user.displayName}` : '';
    return `${user.employeeId}${displayName}`;
  }
  
  // Xử lý email bắt đầu bằng "asp" - chỉ hiển thị 4 số sau
  if (user.email && user.email.toLowerCase().startsWith('asp')) {
    const email = user.email.toLowerCase();
    const match = email.match(/^asp(\d{4})@/);
    if (match) {
      const numbers = match[1];
      const displayName = user.displayName ? ` - ${user.displayName}` : '';
      return `ASP${numbers}${displayName}`;
    }
  }
  
  // Nếu không có employeeId và không phải email asp, hiển thị email
  return user.email;
}
```

**Method `getAccountTypeLabel()`:**
```typescript
getAccountTypeLabel(user: any): string {
  if (user.uid === 'special-steve-uid') {
    return 'Tài khoản đặc biệt';
  }
  
  if (user.employeeId) {
    return 'Mã nhân viên ASP';
  }
  
  // Xử lý email bắt đầu bằng "asp"
  if (user.email && user.email.toLowerCase().startsWith('asp')) {
    const email = user.email.toLowerCase();
    const match = email.match(/^asp(\d{4})@/);
    if (match) {
      return 'Mã nhân viên ASP';
    }
  }
  
  return 'Email';
}
```

**Method `getAccountTypeIcon()`:**
```typescript
getAccountTypeIcon(user: any): string {
  if (user.uid === 'special-steve-uid') {
    return '👑';
  }
  
  if (user.employeeId) {
    return '👤';
  }
  
  // Xử lý email bắt đầu bằng "asp"
  if (user.email && user.email.toLowerCase().startsWith('asp')) {
    const email = user.email.toLowerCase();
    const match = email.match(/^asp(\d{4})@/);
    if (match) {
      return '👤';
    }
  }
  
  return '📧';
}
```

### 2. Cập nhật CSS cho cột tên

#### **File:** `src/app/pages/settings/settings.component.scss`

**CSS cho cột tên:**
```scss
// CSS để mở rộng cột tên và đảm bảo không bị xuống dòng
::ng-deep .mat-table {
  .mat-column-displayName {
    min-width: 200px !important;
    max-width: 300px !important;
    width: auto !important;
    
    .mat-cell {
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      max-width: 280px !important;
      
      // Hiển thị tooltip khi hover để xem tên đầy đủ
      &:hover {
        overflow: visible !important;
        white-space: normal !important;
        word-break: break-word !important;
        background-color: #f8f9fa !important;
        border-radius: 4px !important;
        padding: 4px !important;
        z-index: 1000 !important;
        position: relative !important;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15) !important;
      }
    }
  }
  
  // Đảm bảo các cột khác có kích thước phù hợp
  .mat-column-email {
    min-width: 180px !important;
    max-width: 220px !important;
  }
  
  .mat-column-accountType {
    min-width: 120px !important;
    max-width: 140px !important;
  }
  
  .mat-column-role {
    min-width: 100px !important;
    max-width: 120px !important;
  }
  
  .mat-column-department {
    min-width: 80px !important;
    max-width: 100px !important;
  }
  
  .mat-column-factory {
    min-width: 80px !important;
    max-width: 100px !important;
  }
  
  .mat-column-createdAt {
    min-width: 80px !important;
    max-width: 100px !important;
  }
  
  .mat-column-permission,
  .mat-column-completePermission {
    min-width: 60px !important;
    max-width: 80px !important;
  }
  
  .mat-column-lastLoginAt {
    min-width: 80px !important;
    max-width: 100px !important;
  }
  
  .mat-column-actions {
    min-width: 60px !important;
    max-width: 80px !important;
  }
}
```

## Kết quả sau khi cập nhật

### **1. Logic hiển thị tài khoản:**

| Loại tài khoản | Ví dụ | Hiển thị | Icon | Label |
|----------------|-------|----------|------|-------|
| **Tài khoản đặc biệt** | Steve | `👑 Steve` | 👑 | Tài khoản đặc biệt |
| **Có Employee ID** | ADM001 | `ADM001 - Tên` | 👤 | Mã nhân viên ASP |
| **Email ASP** | `asp2197@asp.com` | `ASP2197 - Tên` | 👤 | Mã nhân viên ASP |
| **Email thường** | `user@example.com` | `user@example.com` | 📧 | Email |

### **2. CSS cột tên:**

- **Cột tên** được mở rộng từ 200px đến 300px
- **Tên dài** sẽ hiển thị với dấu "..." (ellipsis)
- **Hover** để xem tên đầy đủ với tooltip đẹp mắt
- **Không bị xuống dòng** trong cột

## Cách test

### **1. Sử dụng nút trong Settings:**
1. Vào trang Settings
2. Kiểm tra hiển thị tài khoản `asp2197@asp.com`
3. Hover vào cột tên để xem tooltip

### **2. Sử dụng Console Debug:**
1. Vào trang Settings
2. Mở Console (F12)
3. Copy và paste script từ `debug-account-display.js`
4. Chạy các lệnh:
   ```javascript
   // Test logic hiển thị
   testAccountDisplay()
   
   // Tìm tài khoản cụ thể
   findSpecificAccount("asp2197")
   
   // Test với dữ liệu mẫu
   testWithSampleData()
   ```

## Ví dụ cụ thể

### **Trước khi cập nhật:**
- `asp2197@asp.com` → hiển thị: `asp2197@asp.com`
- Cột tên: bị cắt ngắn, tên dài bị xuống dòng

### **Sau khi cập nhật:**
- `asp2197@asp.com` → hiển thị: `ASP2197 - Tên người dùng`
- Cột tên: rộng hơn, tên dài hiển thị với "..." và tooltip khi hover

## Lưu ý

1. **Logic mới** chỉ áp dụng cho email bắt đầu bằng "asp" + 4 số
2. **Cột tên** được mở rộng nhưng vẫn giữ layout tổng thể
3. **Tooltip hover** giúp xem tên đầy đủ mà không làm vỡ layout
4. **Tất cả các cột** đều có kích thước tối ưu

## Troubleshooting

### **Tài khoản không hiển thị đúng:**
- Kiểm tra format email có đúng `asp####@asp.com` không
- Kiểm tra console log để debug

### **CSS không áp dụng:**
- Refresh trang
- Kiểm tra console có lỗi CSS không
- Đảm bảo đang ở trang Settings

### **Tooltip không hiển thị:**
- Hover vào cột tên
- Kiểm tra z-index và position
- Đảm bảo không có CSS conflict

---
*Hướng dẫn này mô tả các thay đổi về logic hiển thị tài khoản và CSS để cải thiện trải nghiệm người dùng.*
