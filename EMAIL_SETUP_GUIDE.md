# 📧 HƯỚNG DẪN CÀI ĐẶT CHỨC NĂNG GỬI EMAIL TỰ ĐỘNG

## 🎯 **Mục tiêu**
Hệ thống sẽ gửi email report hàng tuần tự động đến `asm-wh@airspeedmfg.com` với thông tin Inbound và Outbound.

## 📋 **Các tính năng đã thêm**

### 1. **Nút "Gửi Email Report" trong dropdown "More"**
- ✅ Inbound ASM1
- ✅ Inbound ASM2  
- ✅ Outbound ASM1

### 2. **Firebase Functions**
- ✅ `sendWeeklyReport`: Gửi email tự động mỗi thứ 2 lúc 9h sáng
- ✅ `sendReportEmail`: Gửi email theo yêu cầu từ UI

## 🚀 **Cài đặt Firebase Functions**

### Bước 1: Cài đặt dependencies
```bash
cd functions
npm install
```

### Bước 2: Cấu hình email SMTP
Chỉnh sửa file `functions/src/index.ts`:

```typescript
// Thay đổi thông tin email thực
const transporter = nodemailer.createTransporter({
  host: 'smtp.gmail.com', // hoặc SMTP server khác
  port: 587,
  secure: false,
  auth: {
    user: 'your-email@gmail.com', // ⚠️ Thay bằng email thực
    pass: 'your-app-password'     // ⚠️ Thay bằng app password
  }
});
```

### Bước 3: Tạo App Password cho Gmail
1. Vào Google Account Settings
2. Bật 2-Factor Authentication
3. Tạo App Password cho "Mail"
4. Sử dụng App Password thay vì password thường

### Bước 4: Deploy Firebase Functions
```bash
firebase deploy --only functions
```

## 📅 **Lịch gửi email tự động**

### **Email hàng tuần**
- **Thời gian**: Mỗi thứ 2 lúc 9h sáng (GMT+7)
- **Nội dung**: 
  - 📦 Thống kê Inbound (tổng, đã nhận, chờ xử lý, hoàn thành)
  - 🚀 Thống kê Outbound (tổng, hoàn thành, chờ xử lý)
  - 📋 Chi tiết 10 bản ghi gần đây nhất
  - 📊 Bảng thống kê trực quan

### **Email theo yêu cầu**
- **Kích hoạt**: Nhấn nút "Gửi Email Report" trong dropdown "More"
- **Nội dung**: Report tùy chỉnh theo loại và khoảng thời gian

## 🔧 **Cấu hình thêm**

### **Thay đổi lịch gửi email**
```typescript
// Trong functions/src/index.ts
export const sendWeeklyReport = functions.pubsub
  .schedule('0 9 * * 1') // Cron expression: Mỗi thứ 2 lúc 9h sáng
  .timeZone('Asia/Ho_Chi_Minh')
  .onRun(async (context) => {
    // Logic gửi email
  });
```

### **Thay đổi địa chỉ email nhận**
```typescript
const mailOptions = {
  from: 'your-email@gmail.com',
  to: 'asm-wh@airspeedmfg.com', // ⚠️ Thay đổi nếu cần
  subject: `📊 Báo cáo hàng tuần - ${new Date().toLocaleDateString('vi-VN')}`,
  html: emailContent
};
```

## 📧 **Template email**

Email sẽ có format HTML đẹp với:
- 🎨 Header với logo và thông tin tuần
- 📊 Thống kê dạng số liệu trực quan
- 📋 Bảng chi tiết dữ liệu
- 🎯 Footer với thông tin liên hệ

## ⚠️ **Lưu ý quan trọng**

1. **Email sender**: Phải là email thực, không phải email giả
2. **App Password**: Sử dụng App Password, không phải password thường
3. **Firebase Billing**: Functions có thể tính phí nếu vượt quá free tier
4. **Rate Limits**: Gmail có giới hạn 500 email/ngày cho free account

## 🧪 **Test chức năng**

### **Test gửi email theo yêu cầu**
1. Vào bất kỳ trang Inbound/Outbound nào
2. Nhấn nút "More" → "Gửi Email Report"
3. Kiểm tra console và email nhận

### **Test email tự động**
1. Deploy functions
2. Đợi đến thứ 2 lúc 9h sáng
3. Kiểm tra logs: `firebase functions:log`

## 🆘 **Xử lý lỗi**

### **Lỗi SMTP**
- Kiểm tra email và app password
- Kiểm tra 2FA đã bật
- Kiểm tra firewall/antivirus

### **Lỗi Firebase**
- Kiểm tra billing account
- Kiểm tra permissions
- Xem logs: `firebase functions:log`

## 📞 **Hỗ trợ**

Nếu gặp vấn đề, vui lòng:
1. Kiểm tra console logs
2. Kiểm tra Firebase Functions logs
3. Liên hệ IT Support

---

**🎉 Chúc mừng! Hệ thống gửi email tự động đã sẵn sàng!**
