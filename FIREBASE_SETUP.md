# Firebase Setup for Materials Lifecycle

Hướng dẫn cấu hình Firebase cho tính năng Materials Lifecycle Management.

## Bước 1: Tạo Firebase Project

1. Truy cập [Firebase Console](https://console.firebase.google.com/)
2. Nhấn "Create a project" hoặc "Add project"
3. Nhập tên project (ví dụ: `material-dashboard-warehouse`)
4. Enable Google Analytics (tuỳ chọn)
5. Chọn Analytics account (nếu enable)
6. Nhấn "Create project"

## Bước 2: Thêm Web App

1. Trong Firebase Console, nhấn icon web (`</>`)
2. Nhập app nickname (ví dụ: `material-dashboard-web`)
3. Check "Also set up Firebase Hosting" (tuỳ chọn)
4. Nhấn "Register app"
5. Copy Firebase configuration object

## Bước 3: Cấu hình Environment

Cập nhật file `src/environments/environment.ts` và `src/environments/environment.prod.ts`:

```typescript
export const environment = {
  production: false, // true cho environment.prod.ts
  firebase: {
    apiKey: "your-api-key-here",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "your-app-id"
  }
};
```

## Bước 4: Enable Firestore Database

1. Trong Firebase Console, vào "Firestore Database"
2. Nhấn "Create database"
3. Chọn "Start in test mode" (cho development)
4. Chọn location (ví dụ: asia-southeast1)
5. Nhấn "Done"

## Bước 5: Cấu hình Security Rules

Cập nhật Firestore Security Rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Materials collection
    match /materials/{materialId} {
      allow read, write: if true; // Thay đổi theo yêu cầu bảo mật
    }
    
    // Material alerts collection
    match /material-alerts/{alertId} {
      allow read, write: if true;
    }
    
    // Material transactions collection
    match /material-transactions/{transactionId} {
      allow read, write: if true;
    }
  }
}
```

## Bước 6: Tạo Index cho Firestore

Tạo các composite index sau trong Firestore:

### Index cho materials collection:
- Collection: `materials`
- Fields: `status` (Ascending), `expiryDate` (Ascending)

### Index cho material-alerts collection:
- Collection: `material-alerts`
- Fields: `isRead` (Ascending), `createdAt` (Descending)

### Index cho material-transactions collection:
- Collection: `material-transactions`
- Fields: `materialId` (Ascending), `timestamp` (Descending)

## Bước 7: Test Data

Thêm một số dữ liệu test vào Firestore:

### Collection: materials
```json
{
  "materialCode": "MAT001",
  "materialName": "Raw Material A",
  "batchNumber": "BATCH001",
  "expiryDate": "2024-06-30T00:00:00.000Z",
  "manufacturingDate": "2024-01-15T00:00:00.000Z",
  "location": "A1",
  "quantity": 100,
  "status": "active",
  "alertLevel": "green",
  "supplier": "Supplier ABC",
  "costCenter": "CC001",
  "unitOfMeasure": "kg",
  "lastUpdated": "2024-01-20T00:00:00.000Z",
  "createdBy": "System",
  "notes": "Initial stock"
}
```

## Bước 8: Authentication (Tuỳ chọn)

Nếu muốn thêm authentication:

1. Trong Firebase Console, vào "Authentication"
2. Nhấn "Get started"
3. Chọn "Sign-in method" tab
4. Enable các provider cần thiết (Email/Password, Google, etc.)

## Bước 9: Chạy Ứng Dụng

```bash
npm install
ng serve --port 4201
```

Truy cập: `http://localhost:4201/shelf-life`

## Các Tính Năng

### 1. Materials Management
- Thêm/sửa/xóa materials
- Theo dõi expiry dates
- Quản lý locations trong warehouse
- Tự động tính toán alert levels

### 2. Alert System
- Cảnh báo materials sắp hết hạn
- Cảnh báo materials đã hết hạn
- Cảnh báo low stock
- Mark alerts as read

### 3. Analytics
- Tổng quan materials
- Báo cáo theo status
- Báo cáo theo location
- Transaction history

### 4. Search & Filter
- Tìm kiếm theo code, name, batch
- Filter theo status
- Filter theo location
- Realtime updates

## Troubleshooting

### Lỗi thường gặp:

1. **Firebase not initialized**
   - Kiểm tra Firebase config trong environment files
   - Đảm bảo AngularFireModule.initializeApp() được import

2. **Permission denied**
   - Cập nhật Firestore Security Rules
   - Enable Authentication nếu cần

3. **Missing indexes**
   - Tạo composite indexes trong Firestore Console
   - Check browser console cho error messages

4. **Date format issues**
   - Đảm bảo dates được convert thành Date objects
   - Kiểm tra timezone settings

## Production Deployment

Khi deploy production:

1. Cập nhật Security Rules cho production
2. Enable Authentication
3. Cấu hình CORS cho domain
4. Optimize Firestore queries
5. Set up monitoring và alerts

## Support

Nếu gặp vấn đề, kiểm tra:
- [Firebase Documentation](https://firebase.google.com/docs)
- [AngularFire Documentation](https://github.com/angular/angularfire)
- Browser Console để xem error messages 