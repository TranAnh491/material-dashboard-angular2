# Yêu cầu dự án – Airspeed Warehouse (Angular)

> Tài liệu tổng hợp yêu cầu, kiến trúc và quy ước làm việc của dự án. Cập nhật file này khi có yêu cầu mới.

## 1. Mục tiêu

Hệ thống quản lý kho (warehouse management) cho nhà máy Airspeed (ASM1, ASM2, ASM3...), chạy trên web và điện thoại, gồm:

- **RM (nguyên liệu):** nhập kho, xuất kho, tồn kho, kiểm kê, lịch sử túi/batch, nguyên liệu thiếu.
- **FG (thành phẩm):** nhập, xuất, kiểm, tồn kho, vị trí, in tem nội bộ.
- **Sản xuất / điều phối:** PD Control, Work Order, Lịch làm việc, Shipment, Xe tải.
- **Chất lượng & an toàn:** QC, Traceability, Safety & Quality, nhiệt độ, quản lý thiết bị, đào tạo.
- **Báo cáo & tích hợp:** Report, Bonded Report, SXXK, biểu mẫu, thông báo Zalo/email.
- **Layout kho:** Layout warehouse (ASM1/ASM3), J Warehouse (có link xem công khai, chỉ đọc).

Giao diện và nội dung hiển thị chủ yếu bằng **tiếng Việt**.

## 2. Công nghệ

| Lớp | Công nghệ |
|---|---|
| Frontend | Angular 14, Angular Material 14, Bootstrap 4, TypeScript 4.7, RxJS 7.5 |
| Backend | Firebase (project `airspeed-warehouse`): Firestore, Auth, Storage, Hosting |
| Cloud Functions | `functions/` (default), `functions-work-order-kitting/`, `functions-stockcheck-monthly/`, `zalo/` |
| Thư viện chính | exceljs / xlsx (import-export), jspdf, html2canvas, qrcode, html5-qrcode, @zxing/library, jsqr (quét mã), tesseract.js (OCR), chart.js, three (layout 3D), signature_pad |
| Routing | `useHash: true`, lazy-load module, `SelectivePreloadStrategy` |

Yêu cầu môi trường: Node >= 16, npm >= 8.

## 3. Cấu trúc mã nguồn

- `src/app/pages/` – mỗi chức năng một thư mục (inbound, outbound, materials, fg-*, qc, nhiet-do, equipment-checklist, settings, zalo, j-warehouse...).
- `src/app/services/` – service dùng chung (Firebase, phân quyền, import Excel, OTP, thông báo, cache catalog...).
- `src/app/guards/` – `auth.guard`, `settings.guard`, `tab-permission.guard`.
- `src/app/routes/sidebar-routes.ts` – định nghĩa menu sidebar.
- `functions/src/` – Cloud Functions (OTP, Zalo, email báo cáo, backup, đăng ký user admin...).
- `firestore.rules`, `storage.rules`, `firestore.indexes.json` – bảo mật và index.

## 4. Yêu cầu chức năng chính

### 4.1 Xác thực & phân quyền
- Đăng nhập bằng mã nhân viên ASP hoặc email (Firebase Auth); có đăng nhập bằng quét mã.
- Phân quyền theo **tab** và theo **nhà máy** (ASM1/ASM2/...): user chỉ thấy tab/nhà máy được cấp.
  - Mặc định **không cấp quyền** khi chưa cấu hình (không mở toàn bộ như trước).
  - Sidebar lọc theo quyền (`FilteredRoutesService`).
- Admin đăng ký / đổi mật khẩu / sửa hồ sơ / đồng bộ user; có force-logout.
- Chi tiết: xem `ACCESS_CONTROL_README.md`, `FIREBASE_SECURITY_GUIDE.md`.

### 4.2 Nghiệp vụ kho
- Quét QR/barcode, in tem (tem thùng, tem lẻ, tem xuất kho, tem nội bộ pallet).
- Quản lý vị trí kho, quy tắc vị trí, mở khóa thêm vị trí bằng **OTP**.
- Kiểm kê (stock check), kiểm tra cân PXK (ảnh cân, báo cáo lệch), báo cáo tồn kho.
- Import Excel cho catalog/tồn kho (xem các file `*_IMPORT_GUIDE.md`, `catalog_import_template.*`).
- Các thao tác nhạy cảm (xóa catalog, bypass PXK, sửa LSX, mở khóa tồn) cần **OTP / xác nhận**.

### 4.3 Thông báo & báo cáo tự động
- Zalo: nhắc nhiệt độ, checklist thiết bị, hướng dẫn quét kiểm kê, ready-IQC, tồn quá hạn, tem in trễ...
- Email: báo cáo QC hàng tháng, báo cáo tồn kho, lịch xe tải, cảnh báo quy cách đóng gói, báo cáo giữ putaway hằng tuần.
- Backup định kỳ (FG hằng ngày, RM hằng tuần).

### 4.4 Cập nhật client
- Sau mỗi lần deploy, hệ thống gửi **token reload** để client hiện popup "Đã có bản cập nhật mới" kèm danh sách tính năng mới (`release-notes.txt`).

## 5. Quy ước làm việc

- **Deploy:** chỉ deploy Firebase main bằng `npm run deploy:hosting` (build + deploy + notify reload). Không deploy Netlify / FG Label nếu user không yêu cầu rõ.
- **Release notes:** trước mỗi lần deploy hosting, ghi `release-notes.txt` ở thư mục gốc – tiếng Việt, mỗi dòng một tính năng/sửa lỗi, mô tả đơn giản. Script `notify-clients-reload.js` gửi file này và đổi tên thành `release-notes.last.txt`.
- **Ngôn ngữ UI / comment:** tiếng Việt cho nội dung hiển thị; code đặt tên theo phong cách sẵn có của file xung quanh.
- **Mọi chức năng mới** phải tôn trọng phân quyền tab/nhà máy và ghi audit khi là thao tác thay đổi dữ liệu (`audit.service.ts`).
- **Mobile:** nhiều màn hình dùng trên điện thoại/máy quét – giao diện phải dùng được ở màn hình nhỏ.

## 6. Lệnh thường dùng

```bash
npm start                 # ng serve --port 4201
npm run build             # build production
npm run deploy:hosting    # build + firebase deploy hosting:main + notify reload
npm test                  # karma
```

## 7. Tài liệu liên quan trong repo

`ACCESS_CONTROL_README.md`, `FIREBASE_SETUP.md`, `FIREBASE_SECURITY_GUIDE.md`, `firestore-rules.md`, `EXCEL_IMPORT_GUIDE.md`, `EMAIL_SETUP_GUIDE.md`, `TRAINING_REPORT_FIX_GUIDE.md`, `TABS_ANALYSIS.md`.

## 8. Yêu cầu bổ sung (điền thêm)

- [ ] ...
