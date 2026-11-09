# Đánh giá dự án Airspeed Warehouse — 07/11/2026

Phạm vi: bảo mật (đăng nhập, quyền, Firestore/Storage rules, Cloud Functions), toàn vẹn dữ liệu tồn kho
(Inbound / Outbound / FG), hiệu năng & chi phí Firestore, lịch chạy Cloud Functions.
Mỗi phát hiện đều đã đọc lại code gốc; các nghi vấn sai đã loại (xem mục cuối).

---

## A. Bảo mật — làm ngay

### A1. Đăng nhập bằng quét thẻ chỉ cần mã ASP, ai cũng gọi được (nghiêm trọng)
- `functions/src/scan-login.ts` + `scanLoginFn` (`functions/src/index.ts` ~dòng 1707).
- Hàm không cần đăng nhập trước, không có App Check, không giới hạn số lần thử. Chỉ cần chuỗi `ASP` + 4 số
  có trong `users` là nhận custom token đăng nhập của nhân viên đó (trừ admin).
- 4 chữ số = 10.000 khả năng, dò hết trong vài phút từ trang web công khai.
- Kết hợp A2 → người ngoài đọc / sửa được tồn kho, phiếu xuất, Work Order.
- Hướng sửa (chọn 1 hoặc kết hợp):
  1. Thẻ nhân viên in thêm **mã bí mật** (QR chứa `ASP0106|<chuỗi ngẫu nhiên>`), server so khớp chuỗi đó.
  2. Bật **App Check** cho callable + giới hạn số lần thử theo IP / theo mã.
  3. Chỉ cho đăng nhập quét thẻ từ thiết bị kho đã đăng ký (device token).

### A2. Luật Firestore "đăng nhập là đọc / ghi hầu hết collection"
- `firestore.rules`: `match /{col}/{document=**} { allow read, write: if request.auth != null && !hasOwnRules(col); }`
- Chỉ 11 collection có luật riêng. Mọi thứ còn lại (tồn kho, outbound, work-orders, app-settings, OTP…)
  ai có phiên đăng nhập — kể cả phiên quét thẻ (A1) và tài khoản xe tải (A4) — đều đọc / ghi / xóa được.
- Cờ `hasReadOnlyPermission`, quyền tab, "chỉ admin" đều chỉ kiểm ở giao diện; gọi Firestore trực tiếp thì không bị chặn.
- Hướng sửa từng bước (không cần làm một lần):
  1. Khóa ngay các collection chỉ server dùng (A3).
  2. Phiên `scan: true` và tài khoản xe tải: chỉ đọc, chỉ ghi vào vài collection cần cho thao tác quét.
  3. Dần dần thêm luật riêng cho `inventory-materials`, `outbound-materials`, `work-orders`, `app-settings`.

### A3. Mã OTP lưu dạng chữ thường, người dùng thường đọc được (nghiêm trọng)
- `functions/src/location-unlock-otp.ts:67`, `wo-pxk-bypass-otp.ts:100`, `catalog-delete-otp.ts:76`,
  `location-add-otp.ts`, `materials-inventory-otp.ts`, `fg-lot-lsx-otp.ts`, `inbound-ldv-guard.ts` lưu `code: "1234"`.
- Các collection `*-otp` không có luật riêng → rơi vào A2 → bất kỳ tài khoản nào đọc được mã OTP
  rồi tự nhập, **vô hiệu hóa toàn bộ cơ chế OTP** (mở khóa vị trí, xóa danh mục, bỏ qua PXK thiếu…).
- `zalo_group_config/*` (nhóm nhận OTP / cảnh báo) cũng ghi được → có thể đổi sang chat khác.
- Đã kiểm tra: app web **không** đọc / ghi các collection này (chỉ Cloud Functions + bot Zalo dùng Admin SDK).
- Hướng sửa an toàn, không ảnh hưởng chức năng — thêm vào `firestore.rules` trước luật chung và bổ sung tên vào `hasOwnRules`:
  ```
  match /location-unlock-otp/{id}   { allow read, write: if false; }
  match /location-add-otp/{id}      { allow read, write: if false; }
  match /wo-pxk-bypass-otp/{id}     { allow read, write: if false; }
  match /catalog-delete-otp/{id}    { allow read, write: if false; }
  match /materials-inventory-otp/{id} { allow read, write: if false; }
  match /fg-lot-lsx-otp/{id}        { allow read, write: if false; }
  match /inbound-ldv-otp/{id}       { allow read, write: if false; }
  match /zalo_group_config/{id}     { allow read, write: if false; }
  ```
  Thêm: lưu **hash** của mã thay vì mã gốc.

### A4. Tài khoản xe tải mật khẩu cố định `123456` trong code
- `functions/src/truck-driver-auth.ts:11-27`: `ASP9999` / `XETAI`, mật khẩu `123456`, ghi thẳng trong mã nguồn.
- Ai biết mật khẩu (hoặc đọc repo) đều có phiên đăng nhập → theo A2 là ghi được dữ liệu kho.
- Hướng sửa: chuyển mật khẩu sang Secret Manager, đổi mật khẩu, và giới hạn quyền tài khoản xe tải trong rules.

### A5. Đăng ký lại xóa tài khoản cũ (mức thấp)
- `admin-register-user.ts` → `releaseEmailForNewRegistration`: đăng ký công khai với đúng email + mã ASP của
  người khác sẽ xóa tài khoản cũ, cấp mật khẩu mới (gửi về email chủ thật). Không chiếm được tài khoản
  nhưng làm người đó mất mật khẩu. Nên bắt xác nhận qua email trước khi xóa.

---

## B. Toàn vẹn dữ liệu tồn kho

### B1. Outbound: lưu phiếu xuất trước, trừ tồn chạy ngầm, lỗi bị nuốt (cao)
- `outbound.component.ts` `batchUpdateAllScanData` (~dòng 5060): commit `outbound-materials` rồi gọi
  `updateInventoryInBackground` **không await**; `updateInventoryExported` (~dòng 5788) bắt mọi lỗi và chỉ ghi log.
- Mạng chập chờn / đóng tab ngay sau khi lưu → có phiếu xuất nhưng tồn **không bị trừ**, không thử lại, không ai biết.
  Tự lưu 5 phút (mới thêm) làm tình huống này dễ xảy ra hơn nếu nhân viên đóng máy ngay sau đó.
- Hướng sửa: gộp ghi phiếu xuất + `increment` tồn vào **cùng một batch** (cả hai thành công hoặc cùng thất bại);
  đọc dòng tồn trước khi commit; lỗi thì giữ lại danh sách chờ để lưu lại.

### B2. Inbound: đánh dấu "đã nhận" và tạo dòng tồn là 2 bước rời
- `inbound.component.ts` `addToInventory` (~dòng 1229) chạy sau khi đã ghi `isReceived: true`
  (ví dụ nhận hàng trả ~dòng 8695). Lỗi thì có hoàn tác, nhưng đóng tab giữa chừng → phiếu "đã nhận" mà kho không có dòng.
- Kiểm tra trùng (`checkForDuplicateInInventory`) rồi `add` không nằm trong transaction → 2 máy nhận cùng lúc có thể tạo 2 dòng tồn.
- Hướng sửa: tạo dòng tồn + cập nhật phiếu nhập trong cùng batch / transaction; doc id tồn kho xác định
  (ví dụ theo id phiếu nhập) để lần ghi thứ hai không tạo trùng.

### B3. FG: trừ tồn kiểu "đọc rồi ghi đè", không chờ, lỗi chỉ ghi log
- `fg-out.component.ts` `subtractFromInventoryDocs` (~dòng 3568) và đoạn hoàn trả (~dòng 3670):
  `ton = cũ − x`, `xuat = cũ + x` rồi `update()` không await.
- 2 máy xuất cùng mã TP cùng lúc → ghi đè nhau, mất một lần trừ. Lỗi ghi → tồn FG sai mà không báo.
- Hướng sửa: dùng `FieldValue.increment`, await, báo lỗi rõ.

### B4. Trường `stock` lưu cố định lúc nhập
- Dòng tồn RM tạo với `stock: material.quantity` nhưng tồn thật được tính `đầu kỳ + nhập − xuất − XT`.
  Chỗ nào đọc thẳng `stock` sẽ thấy số cũ. Nên bỏ trường này hoặc đặt tên rõ là `stockAtReceive`.

---

## C. Hiệu năng & chi phí

### C1. FG Out đọc toàn bộ lịch sử FG mỗi lần bấm
- `fg-out.component.ts` `loadInventoryForShipment` (~dòng 4547/4586): đọc **toàn bộ** `fg-inventory`, `fg-in`,
  `fg-export` mỗi lần bấm / mở. `fg-in` và `fg-export` tăng mãi → chi phí tăng theo thời gian.
  Comment ghi "chỉ nhà máy của shipment" nhưng code không lọc.
- Hướng sửa: lọc theo nhà máy + mã TP của shipment, hoặc dùng số tồn đã tính sẵn trong `fg-inventory`.

### C2. Code chết nên xóa
- `fg-in.service.ts` `getAllImportRecords()` và `shipment.component.ts` `loadFGInventoryCache()`
  (listener realtime trên nguyên collection) — không còn ai gọi. Xóa để tránh ai đó dùng lại.

---

## D. Đã rà, KHÔNG phải vấn đề (loại báo nhầm)
- 2 trigger `onWrite` trên `inventory-materials` (`notifyNegativeStockZalo`, `notifyFridgeWrongLocationZalo`):
  thoát sớm, không đọc thêm khi không vượt ngưỡng → chi phí thấp.
- `runJitScheduledCallsJob` chạy mỗi 5 phút: chỉ truy vấn dòng đã tới giờ hẹn → rẻ.
- `publicRegisterAspUserFn`: bắt buộc email đuôi công ty, mật khẩu gửi về đúng email → không chiếm được tài khoản.
- Route công khai `j-warehouse-view`: không đăng nhập nên rules chặn đọc dữ liệu → không lộ dữ liệu.
- Firebase API key trong `environment.ts`: là khóa công khai theo thiết kế của Firebase, không phải bí mật.
- Các callable còn lại đều kiểm `context.auth` ngay đầu hàm (chỉ 4 hàm công khai: đăng ký, tra email, quét thẻ, xe tải).

## E. Điểm làm tốt
- Quyền admin dựa trên custom claim server gán, không dựa trường `role` client sửa được.
- OTP qua Zalo cho thao tác nhạy cảm (ý tưởng đúng — chỉ cần sửa A3).
- `read-tracker` + read guard theo dõi chi phí đọc.
- Trigger Cloud Functions viết có thoát sớm, dedupe gửi Zalo bằng transaction.

---

## Thứ tự đề xuất
| # | Việc | Rủi ro nếu để | Công sức |
|---|---|---|---|
| 1 | A3: khóa collection OTP + zalo_group_config trong rules | Vô hiệu hóa mọi OTP | Nhỏ (chỉ sửa rules, deploy rules) |
| 2 | A1: thêm bí mật vào thẻ / App Check cho đăng nhập quét thẻ | Người ngoài vào được hệ thống | Vừa |
| 3 | B1: gộp ghi phiếu xuất + trừ tồn trong 1 batch | Lệch tồn RM âm thầm | Vừa |
| 4 | A4: bỏ mật khẩu xe tải khỏi code | Tài khoản dùng chung lộ | Nhỏ |
| 5 | B3: FG dùng increment + await | Lệch tồn FG khi xuất đồng thời | Nhỏ |
| 6 | A2: siết rules từng collection | Mọi tài khoản sửa được mọi thứ | Lớn, làm dần |
| 7 | B2, C1, B4, C2 | Lệch dữ liệu hiếm / chi phí tăng dần | Nhỏ–vừa |

---

## Cập nhật trạng thái sửa (07/11/2026 tối)
| Mục | Trạng thái |
|---|---|
| A1 Quét thẻ dò mã | ĐÃ SỬA (code): đếm lần quét sai theo IP, > 20 lần / 15 phút → khóa 15 phút + Zalo admin. Thẻ & thao tác giữ nguyên. Cần **deploy functions**. App Check (chặn hoàn toàn gọi từ ngoài app) cần tạo khóa reCAPTCHA trên Firebase Console — chưa làm. |
| A2 Rules quá rộng | MỘT PHẦN: khóa các collection chỉ máy chủ dùng. Chưa siết inventory / outbound / work-orders để không đổi thao tác kho — cần làm dần, có thử. |
| A3 OTP đọc được | ĐÃ SỬA (rules): khóa 7 collection *-otp, zalo_group_config, 3 collection chống gửi trùng, scan-login-throttle. Cần **deploy rules**. |
| A4 Mật khẩu xe tải | ĐÃ SỬA (code): chuyển sang secret TRUCK_DRIVER_PASSWORD. Trước khi deploy functions phải chạy `firebase functions:secrets:set TRUCK_DRIVER_PASSWORD` (đặt lại 123456 nếu muốn tài xế giữ nguyên). |
| A5 Đăng ký xóa tài khoản cũ | **BÁO NHẦM** — đọc lại: đăng ký công khai đã từ chối khi mã / email đã có tài khoản; chỉ admin mới xóa tạo lại. Không sửa. |
| A6 (mới) Mật khẩu ghi cứng ASP0001/112233 ở màn đăng nhập | ĐÃ GỠ. Đường này đã bị rules chặn nên không vào được, nhưng là cửa sau nằm trong mã nguồn công khai. |
| B1 Outbound | ĐÃ SỬA + có test: phiếu xuất + trừ tồn cùng 1 batch (cả 3 đường: quét theo LSX, camera, máy scan từng tem); lưu lỗi giữ tem; tự lưu không xóa tem quét thêm. |
| B2 Inbound | ĐÃ SỬA + có test: dòng tồn mã cố định IB_<id phiếu nhập>, tạo trong transaction — không trùng. |
| B3 FG | ĐÃ SỬA + có test: trừ tồn + fg-export cùng batch, cộng dồn nguyên tử, đúng trường ton/stock; hoàn tác ở FG Inventory cũng cộng dồn. |
| B4 Trường stock | **KHÔNG PHẢI LỖI ĐANG XẢY RA** — các màn hình đọc tồn đều tính lại (đầu kỳ + nhập − xuất − XT). Giữ nguyên. |
| C1 FG Out đọc toàn bộ | ĐÃ SỬA: fg-in / fg-export chỉ đọc theo mã TP của shipment (lỗi → đọc toàn bộ như cũ). |
| C2 Code chết | ĐÃ XÓA. |

Test tự động: `src/app/pages/outbound/outbound-save.spec.ts` — 13/13 đạt (chạy:
`npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/pages/outbound/outbound-save.spec.ts`).
