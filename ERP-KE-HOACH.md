# ERP — Kế hoạch 7 ngày × 5 tiếng (04/11 → 10/11/2026)

## 1. Hiện trạng 3 dự án nguồn

| Dự án | Vị trí | Công nghệ | Firebase | Quy mô |
|---|---|---|---|---|
| **Kho (Angular)** | `C:\Users\PC\material-dashboard-angular2` | Angular 14 + Material, NgModule | `airspeed-warehouse` | 45 trang, ~400 file, 3 bộ Cloud Functions |
| **SXXK** | `C:\Users\PC\airspeed project\ton-sxxk-firebase` | HTML/JS thuần, 1 file `index.html` ~300 KB + functions | `airspeed-vietnam` | Tồn SXXK, Aging |
| **ASP Project** | `C:\Users\PC\airspeed project\airspeed-firebase` | HTML/JS thuần, ~30 file JS (~800 KB) | `airspeed-vietnam` | Project Manager, Org Chart, nhân sự, JD, KPI, RFQ, ECN, Operations, Settings… |

Không gộp: `game-go-dau`, `deliverables` (tài liệu), app Windows "ASP Chấm công".

Điểm cần gom: 2 Firebase project, 3 cách đăng nhập, 3 bộ layout/menu, logic Excel / QR / in nhãn / thông báo bị lặp.

## 2. Kiến trúc app mới `ERP`

- **Thư mục**: `C:\Users\PC\erp` (repo git mới; 3 app cũ giữ nguyên, chạy song song)
- **Angular 18, standalone components, lazy route theo module**, signals cho state
- **Một shell chung**: đăng nhập 1 lần, menu theo quyền, thông báo, popup reload
- **Firebase**: kết nối **cả 2 project** (`airspeed-warehouse` + `airspeed-vietnam`) → **không di chuyển dữ liệu** tuần này
- **Cấu trúc**
  ```
  src/app/
    core/         auth, quyền, firebase, guard, reload
    shared/       bảng, dialog, scanner QR, Excel, in nhãn, pipe
    modules/
      kho/        inbound, outbound, location, stock-check, materials, ...
      thanh-pham/ fg-in, fg-out, fg-inventory, fg-check, shipment, ...
      san-xuat/   work-order, pd-control, work-schedule, shorted
      chat-luong/ qc, equipment, nhiệt độ, scrap
      sxxk/       tồn SXXK, aging, danh mục NVL-TP
      du-an/      PM, RFQ, ECN, gantt, templates        (từ ASP)
      to-chuc/    org chart, nhân sự, JD, KPI, rules    (từ ASP)
      he-thong/   settings, account, biểu mẫu, documents
  functions/      gom 3 bộ Cloud Functions, deploy theo nhóm
  ```

## 3. Lịch làm việc

| Ngày | 5 tiếng | Kết quả cuối ngày |
|---|---|---|
| **N1 — T4 04/11** | Đọc toàn bộ 3 dự án → bản đồ trang / collection / service / logic trùng. Tạo repo `erp`, Angular 18, nối 2 Firebase | Bản đồ dự án + app khởi chạy |
| **N2 — T5 05/11** | `core` + `shared`: đăng nhập thống nhất, phân quyền, layout mới, gom Excel / QR / in nhãn / thông báo | Đăng nhập, menu khung, tiện ích chung |
| **N3 — T6 06/11** | Port nhóm **Kho**, viết lại trên shared, bỏ code trùng | Kho chạy trên dữ liệu thật |
| **N4 — T7 07/11** | Port **Thành phẩm + Sản xuất + Chất lượng** | Toàn bộ app Angular cũ đã sang ERP |
| **N5 — CN 08/11** | Port **SXXK**: tách file 300 KB thành component/service, gộp với `sxxk`, `aging-report`, `danh-muc-nvl-tp` bên Angular | Một module SXXK duy nhất |
| **N6 — T2 09/11** | Port **ASP Project**: PM, RFQ, ECN, Org chart / nhân sự, KPI, Settings. Phần chưa kịp (deck, canvas…) → nhúng tạm để không thiếu chức năng | Mọi chức năng ASP mở được trong ERP |
| **N7 — T3 10/11** | Gom Cloud Functions, kiểm thử desktop + điện thoại, tối ưu bundle, release notes, deploy lên hosting **mới** | ERP online, chạy song song app cũ |

Mỗi ngày: 4 tiếng làm + 1 tiếng kiểm tra trên trình duyệt, commit, báo cáo cuối ngày.

## 4. Rủi ro

- ~2 MB code trong 35 tiếng là rất sát. Phần ASP nặng nhất (`org-mgmt.js` 127 KB, `org-canvas`, `deck`) có thể nhúng tạm, port hẳn ở tuần 2.
- Dữ liệu vẫn ở 2 Firebase project; gộp về 1 project là việc riêng, làm sau.
- App cũ không tắt cho tới khi bạn xác nhận ERP dùng được.

## 5. Cần bạn xác nhận trước N1

1. Đặt ERP ở `C:\Users\PC\erp`, hosting Firebase mới `airspeed-erp` — được không?
2. Nâng lên Angular 18 (khuyên dùng) hay giữ Angular 14?
