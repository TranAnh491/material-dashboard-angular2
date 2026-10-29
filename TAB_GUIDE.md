# Danh mục Tab, trạng thái sử dụng và quy ước thiết kế

> Khảo sát ngày 2026-10-24 trên nhánh `master`.
> **Cách khảo sát:** đọc routing, sidebar, menu, phân quyền; thống kê số dòng, lịch sử git; trích collection Firestore, Cloud Function và nhãn giao diện của từng trang.
> Phần "Chức năng" suy ra từ các dữ liệu đó, **chưa đọc từng dòng logic**. Mục nào ghi *(cần xác nhận)* thì nên hỏi người dùng nghiệp vụ trước khi xóa hoặc sửa.

## 0. Cách tab được đăng ký trong hệ thống

**Từ 24/10/2026 chỉ còn 2 chỗ** (trước đây phải sửa 9 file):

| # | Nơi đăng ký | File |
|---|---|---|
| 1 | Route (lazy module hoặc component) | `src/app/layouts/admin-layout/admin-layout.routing.ts` |
| 2 | Khai báo tab: key quyền, tiêu đề, phụ đề, icon Menu / sidebar / Dashboard, nhóm quyền, cờ `desktopOnly`, `ownNav`, `adminOnly`; bố cục sidebar (`SIDEBAR_LAYOUT`) | `src/app/routes/app-tabs.ts` |

Menu, sidebar, Dashboard mobile, `TabPermissionGuard`, `FilteredRoutesService`, popup cấp quyền trong Settings, `MobileDetectionService` và navbar đều đọc từ `app-tabs.ts`, không còn danh sách riêng.

Ngoại lệ: `/xe-tai` và `/tai-khoan` chỉ cần đăng nhập (`AuthGuard`), không qua `TabPermissionGuard`.
`/j-warehouse-view` là link công khai, chỉ xem, không cần đăng nhập.

---

## 1. Chi tiết chức năng từng tab

Ký hiệu trạng thái: ✅ đang dùng · ⚠️ ít dùng / cần xác nhận · ❌ không dùng.

### 1.1 Nhóm Main

| Tab (route) | TT | Chức năng |
|---|---|---|
| **Menu** `/menu` | ✅ | Trang chủ dạng thẻ, nhóm theo Main / RM / ASM FG / Quality / Tools / Report / Admin. Có ô tìm kiếm, ẩn các tab chỉ-desktop trên điện thoại, hiển thị phụ đề từng thẻ. |
| **Dashboard** `/dashboard` | ✅ | Tổng quan vận hành: tồn kho (`inventory-materials`), nhập kho, work order, shipment 7 ngày tới, FG in. Dùng cache `dashboard-cache`, biểu đồ Chart.js, lối tắt sang các tab. Rất hay sửa (33 commit từ tháng 7). |
| **Work Order** `/work-order-status` | ✅ | Lõi sản xuất. Tab theo khu: HOME, ASM1, ASM2, ASM3, SAMPLE 1/2. Tạo work order, import từ Excel, import PXK (ánh xạ cột), duyệt / từ chối, quét QR, in. Trạng thái: Waiting → Kitting → Ready → Ready-IQC → Transfer → Done / Delay. Dữ liệu: `work-orders`, `pxk-import-data`, `pxk-bs-data`, `rm1-delivery-records`. Lớn nhất sau Materials (9.3k dòng, 35 commit). |
| **Shipment** `/shipment` | ✅ | Lịch giao hàng: Dispatch Performance, số carton theo ngày dispatch, Summary. Liên kết `fg-out`, `fg-inventory`, `fg-check`, `fg-customer-mapping`. Có ghi chú độ rộng cột trong `COLUMN-WIDTHS-REFERENCE.md`. |
| **Lịch Làm Việc** `/lich-lam-viec` | ✅ | Xếp lịch theo tuần: công việc, nhóm, nhân viên và kỹ năng, phần cài đặt. |
| **PD Control** `/pd-control` | ✅ | Tra cứu và đối chiếu xuất nguyên liệu cho sản xuất (đọc `outbound-materials`). Màn hình nhỏ, chủ yếu tìm / xóa. |
| **Stock Check** `/stock-check` | ✅ | Kiểm kê bằng quét: chọn nhà máy, quét vị trí, khớp mã, xác nhận đủ lượng hoặc báo thiếu lượng, báo mã không có, duyệt xóa, bỏ tick KK. Dữ liệu: `inventory-materials`, `stock-check-missing`, `stock-check-shortage`, `inventory-kk-history`. Có chế độ laptop và chế độ quét. |
| **Xe Tải** `/xe-tai` | ✅ | Lịch xe tải: lịch chạy cố định, quy định, quét QR, gửi email quyết định giao xe (Cloud Function). Tài xế có đăng nhập riêng (`truckDriverSignInFn`). Mở cho mọi tài khoản. |

### 1.2 Nhóm RM (nguyên liệu)

| Tab (route) | TT | Chức năng |
|---|---|---|
| **RM Inbound** `/inbound` | ✅ | Nhập kho NVL, gộp ASM1 + ASM2 (nút chuyển nhà máy). Quét lô hàng / DNNK, nhập mã nhân viên, trạng thái IQC, tuần trước / tuần sau, ghi chú lưu ý, danh mục lệch Standard, sửa lượng đơn vị, kiểm lệch LDV (`inbound-ldv-mismatches`), import / export, cân GW bag. Dữ liệu chính: `inbound-materials`, `inventory-materials`, `inbound-notes`. |
| **RM Outbound** `/outbound` | ✅ | Xuất NVL: quét nhân viên → chọn nhà máy → quét LSX → quét xuất kho, danh sách đã scan, QC rule, import PX / BS, log LSX từng bag, chụp ảnh cân, hủy / nhận bag, báo không cân được. Giao diện scan dùng chung với Inbound (`shared/scan-board.scss`). |
| **RM Inventory** `/materials` | ✅ | Tồn kho NVL – tab lớn nhất dự án (26k dòng, 102 commit). Tồn theo vị trí / bag, kiểm kê (tick KK, quét, tiến độ), đổi vị trí / pallet, gán pallet, xóa vị trí, so sánh tồn LinkQ, import file tiêu hủy, danh mục vị trí / nhóm mã / dãy kệ, lọc khách hàng, dọn vị trí sai hàng loạt, in tem kệ. Có file riêng cho mobile (`materials-mobile.scss`). |
| **Quản lý Nguyên Liệu** `/quan-ly-nguyen-lieu` | ✅ | Kiểm tra KK theo loại hàng, mã hàng và vị trí (desktop: sơ đồ kệ / loại hàng, scan kiểm kê, báo cáo KK; mobile/PDA: tìm mã → đổi vị trí / kho). Từ 24/10/2026 là component riêng `pages/quan-ly-nguyen-lieu/` kế thừa `MaterialsComponent`; dùng chung quyền `materials`, template và SCSS của Materials. |
| **RM Overview** `/inventory-overview` | ✅ | Tổng hợp tồn NVL (chỉ xem), đối chiếu file LinkQ (`linkQFiles`). Chỉ-desktop. |
| **Control Batch** `/bag-history` | ✅ | Truy vết lịch sử từng bag / bịch (i/tổng, bịch tách / lẻ), kiểm tra xuất kho trùng (cùng nhà máy + mã + PO + IMD + bag), có cài đặt và hướng dẫn. |
| **Danh Mục NVL & TP** `/danh-muc-nvl-tp` | ✅ | **Nơi duy nhất sửa danh mục** (đã gộp từ Materials và FG In): Standard Packing NVL, danh mục TP, mapping KH-TP, NVLKH, DV lưu trữ; danh sách không cần cân / mã thêm vào check lượng PXK / kiểm 100%; báo cáo chờ duyệt, đề xuất sửa Standard Packing từ lịch sử Outbound. Hay sửa (12 commit). Chỉ-desktop. |
| **Label** `/label` | ✅ | In tem nhãn NVL / theo lịch in (`print-schedules`): trạng thái in, chụp 2 bước (bản vẽ + tem đã in, tối đa 250KB / ảnh), import Excel, danh mục người in / tình trạng, danh sách mail cảnh báo tem trễ kế hoạch. Có sẵn nhiều nút debug (xem mục 2). |
| **Materials (Vị trí NVL)** `/location` | ✅ | Thao tác vị trí NVL bằng quét theo bước: cất hàng (put-away), đổi pallet, dời kệ, đổi vị trí; quản lý quy tắc vị trí (`location-rules`, `location-warehouse-rules`), khóa / mở khóa vị trí bằng OTP. ASM1 / ASM2. |
| **J Warehouse** `/j-warehouse` | ✅ | Sơ đồ kho J (105m × 30m) kèm xem 3D giá kệ (three.js), link công khai chỉ xem `/j-warehouse-view`. Chỉ-desktop. 27 commit từ tháng 7. |
| **Materials Dashboard** `/materials-dashboard` | ✅ | Bảng điều khiển NVL từ `stock-check-snapshot`, cho tùy chỉnh bố cục (lưu / khôi phục mặc định). Chỉ-desktop. |
| **Shorted Materials** `/shorted-materials` | ⚠️ | Dán danh sách mã thiếu rồi thêm vào bảng theo dõi. Chưa đổi từ tháng 5, chỉ-desktop. |
| **RM Delivery** `/rm1-delivery` | ⚠️ | Ghi nhận giao NVL RM1 (`rm1-delivery-records`), được Work Order dùng lại. Ít sửa (1 commit từ tháng 7). |

### 1.3 Nhóm ASM FG (thành phẩm)

| Tab (route) | TT | Chức năng |
|---|---|---|
| **FG In** `/fg-in` | ✅ | Nhập TP: lọc ASM1 / ASM2 / TOTAL, vùng Temp 1/2/3, xác nhận số thùng carton đúng / sai, phiếu chờ, báo cáo, hiện lại item đã ẩn. Có giao diện mobile (chọn nhà máy bằng popup). |
| **FG Out** `/fg-out` | ✅ | Xuất TP theo shipment: lọc cột, hiện / ẩn, export / import, giới hạn 30 ngày, hoàn tác (`fg-out-undo`), xóa mềm (`fg-deleted-docs`). Chỉ-desktop. |
| **FG Check** `/fg-check` | ✅ | Kiểm TP trước giao: nhập số shipment, xóa item đã lock, tải báo cáo Check theo tháng; tối ưu cache + virtual scroll cho dữ liệu lớn. |
| **FG Inventory** `/fg-inventory` (+ `/fg-inventory/tp-list`) | ✅ | Kho TP: tồn theo vị trí, thống kê TP theo thùng, NVL còn ngoài line, sơ đồ kho TP (modal), danh sách tồn TP. Lớn (6.2k dòng, 31 commit). |
| **FG Overview** `/fg-overview` | ✅ | Tổng quan tồn FG, có import tồn kho. Chỉ-desktop. |
| **Aging Report** `/aging-report` | ✅ | (Từ 29/10/2026) Kiểm báo cáo tuổi hàng TP của ASM1 (KZ) + ASM2 (LH) với bảng kê phiếu nhập / xuất theo Mã TP + Mã lô + Kho; đối chiếu tổng tồn với Báo cáo tồn kho. Import nhiều file một lần, bảng kê lưu lâu dài theo tháng (`aging-ledger`, `aging-reports`, `aging-inventory`, `aging-meta`) để SXXK dùng lại qua `services/aging-report.service.ts`. Chỉ-desktop. |
| **FG Location** `/fg-location` | ✅ | Đổi vị trí TP bằng quét: chọn ASM1 / ASM2 → quét vị trí hiện tại (hiện toàn bộ mã tại đó) → quét vị trí mới; kiểm kê vị trí khác. Sơ đồ luồng trong `fg-location/FLOW-DIAGRAM.md`. |
| **In tem nội bộ** `/pallet-id` | ✅ | Tạo và in tem pallet: tem PASS, Đã kiểm, NVL trả / Return, tem an toàn, tem pallet tạm, tem kệ (R/S), in theo số; dọc / ngang; mẫu tem nội bộ tự tạo (`pallet-internal-templates`). |
| **FGs Dashboard** `/fgs-dashboard` | ✅ | Bảng điều khiển TP, tùy chỉnh bố cục như Materials Dashboard. |

### 1.4 Nhóm Quality

| Tab (route) | TT | Chức năng |
|---|---|---|
| **Quality** `/qc` | ✅ | IQC / QC: duyệt lô theo quyền IQC (`qc-iqc-permissions`), lấy mẫu có bộ đếm, thống kê, gửi báo cáo tháng và email xử lý ưu tiên (Cloud Function). Quyền tab `qc` bao luôn Traceability. |
| **Traceability** `/qc-traceability` | ✅ | Truy xuất theo thời gian một lô: tổng quan, thống kê nhanh, luồng nhập → tồn → xuất, đổi vị trí (`material-location-history`). Dùng chung tabKey `qc`. |
| **Nhiệt Độ** `/nhiet-do` | ✅ | Ghi nhiệt độ và độ ẩm kho bằng quét hoặc nhập tay, sửa số có xác nhận, cài đặt nhắc Zalo. |
| **Quản lý thiết bị** `/equipment-checklist` | ✅ | Checklist thiết bị kho: quét tem QR kiểm tra, mã chưa kiểm / trễ hạn, chart tình trạng trong tháng, bảo dưỡng định kỳ / nội bộ, lịch sử, nhân sự, danh sách thiết bị (có mật khẩu mở), nhắc Zalo. |

### 1.5 Nhóm Report / Admin / Tools khác

| Tab (route) | TT | Chức năng |
|---|---|---|
| **Report** `/report` | ✅ | Thống kê nhập / xuất theo ngày, chi tiết ngày, ẩn lỗi; lấy `report-data`, `inbound/outbound-materials`, `fg-in/out`, `DMTP`; có tỷ giá Vietcombank (`vietcombank-rate.service.ts`). |
| **Biểu mẫu** `/bieu-mau` | ✅ | Thư viện biểu mẫu in: Phiếu xuất kho, sơ đồ phân vùng trách nhiệm 5S kho J4–J5. |
| **Safety & Quality** `/checklist` (cũng `/documents`) | ✅ | Layout an toàn kho (D1…), checklist, biểu mẫu nhiệt độ & độ ẩm WH-P01 (nhập theo ngày sáng / chiều, vẽ chồng lên ảnh). 2 route cùng một module. |
| **Training** `/equipment` | ✅ | Đào tạo kho: Knowledge Test, Training Matrix, SOP, sổ tay, bài kiểm tra có ký online; lưu Firebase. |
| **SXXK** `/sxxk` | ⚠️ | Dữ liệu sản xuất xuất khẩu (`sxxk-data`, `sxxk-meta`), có service nghi vấn `sxxk-suspect`. 1 commit từ tháng 7, chỉ-desktop. |
| **Scrap** `/scrap` | ⚠️ | Quản lý phế liệu (hộp "đổi box"). Có trong menu + navbar riêng; ít sửa, không gọi Firestore trực tiếp. |
| **Bonded Report** `/index` | ⚠️ | Thêm dữ liệu NVL cho báo cáo bonded. Lần sửa cuối 2025-08. Chỉ-desktop. |
| **Zalo** `/zalo` | ✅ | Cấu hình bot Zalo: danh sách ID đã liên kết, rule theo LSX (`zalo-order-rules`, `zalo-user-links`, `zalo-config`). |
| **Settings** `/settings` | ✅ | Quản lý người dùng (đăng ký, import, duyệt, xóa, dọn mã nhân viên), quản lý quyền theo tab / nhà máy, reset mật khẩu qua Cloud Function. Có `SettingsGuard`. |
| **Quản lý tài khoản** `/tai-khoan` | ✅ | Người dùng tự đổi tên và mật khẩu. |
| **Login** `/login` | ✅ | Đăng nhập mã nhân viên / email, quét mã (`scanLoginFn`), đăng ký công khai, đăng nhập tài xế. |

---

## 2. Tab nào còn dùng, tab nào không

### ❌ Không dùng (có thể xóa sau khi xác nhận)

| Mục | Bằng chứng |
|---|---|
| ~~`inbound-fgs`, `outbound-fgs`, `kpi-reports`, `chart`, `layout-warehouse` (trừ util), `layout-warehouse-asm3`~~ | **Đã xóa ngày 2026-10-24.** |
| `pages/outbound-fgs` (route `/outbound-fgs`) | Y hệt trên. |
| `pages/kpi-reports` (route `/kpi-reports`) | Placeholder "Content will be updated soon", không có trong menu hay quyền. Sửa cuối 2025-07. |
| `pages/chart` (`ChartComponent`) | Chỉ được khai báo trong `AdminLayoutModule`, không có route nào và không thẻ `<app-chart>` nào dùng. Sửa cuối 2026-05. |
| `pages/layout-warehouse` và `pages/layout-warehouse-asm3` | Có module riêng nhưng **không có route nào trỏ tới**. Chỉ còn file `layout-warehouse-location.util.ts` được Materials, Inventory Overview, Stock Check import. Sơ đồ kho hiện thay bằng J Warehouse và sơ đồ trong từng trang. *(cần xác nhận)*, nên giữ util và gỡ phần còn lại. |
| Nút debug trong Label (Test Batch Generation, Debug Firebase Data, Kiểm tra & Xóa hết Firebase…) | Công cụ dev nằm trong giao diện thật, nên ẩn hoặc gỡ. |
| Hàng chục file `debug-*.js`, `delete-*.js`, `*_GUIDE.md` rời ở thư mục gốc | Script sửa lỗi một lần; xem `FILES-CO-THE-XOA.md` đã có sẵn danh sách. |

### ⚠️ Còn nhưng ít dùng, nên hỏi người dùng nghiệp vụ

`Bonded Report (/index)`, `SXXK`, `Scrap`, `Shorted materials`, `RM Delivery`, `PD Control`, `Report` (mỗi tab 0–1 commit từ tháng 7).

### ⚠️ Lỗi cấu hình phân quyền phát hiện thêm

- ~~Map URL → tabKey bị lặp và lệch giữa guard và sidebar~~ — **đã sửa 24/10/2026** (gom về `app-tabs.ts`). Trước đó sidebar không bao giờ hiện J Warehouse và Quản lý thiết bị dù user có quyền.
- `firestore.rules` chỉ ràng buộc `users`, `user-permissions`, `user-tab-permissions`; mọi collection còn lại dùng luật chung `{document=**}`. Phân quyền hiện chủ yếu ở phía client.

### ✅ Đang dùng

Toàn bộ các tab còn lại ở mục 1 (hoạt động mạnh nhất: RM Inventory, Work Order, J Warehouse, FG Inventory, FG Out, Dashboard, Settings, Inbound, Outbound, Danh mục NVL & TP).

---

## 3. Quy ước chung khi tạo tab mới / thiết kế

### 3.1 Quy trình tạo tab mới

1. **Thư mục:** `src/app/pages/<ten-tab>/` gồm `<ten-tab>.component.{ts,html,scss}` và `<ten-tab>.module.ts`. Tên tab dạng kebab-case, key quyền trùng tên route.
2. **Module lazy-load:** `RouterModule.forChild([{ path: '', component: X }])`, import `SharedModule` (xem `fg-overview.module.ts` làm mẫu). Dùng `AdminPageCommonModule` nếu cần đủ bộ Material.
3. **Route:** thêm vào `admin-layout.routing.ts` với `canActivate: [AuthGuard, TabPermissionGuard]` (dùng `loadChildren`). Trang nặng cần tải trước thì thêm `data: { preload: true }`.
4. **Khai báo tab trong `routes/app-tabs.ts`:** thêm 1 phần tử vào `APP_TABS` (`path`, `key`, `title`, `subtitle`, `menu`, `permission`…). Muốn hiện trên sidebar thì thêm path vào `SIDEBAR_LAYOUT`; trên lưới Dashboard mobile thì khai báo `dashboard`. Thiếu `permission` thì Settings không cấp quyền được; thiếu cả tab thì guard chặn mọi người.
5. **Dữ liệu mới:** khai báo collection, index (`firestore.indexes.json`), rule (`firestore.rules`); logic nhạy cảm đặt ở Cloud Functions (`functions/src`) và export trong `index.ts`.
6. **Hoàn tất:** build thử, ghi `release-notes.txt` (tiếng Việt, mỗi dòng một tính năng), rồi deploy bằng `npm run deploy:hosting`.

### 3.2 Quy ước giao diện

- **Ngôn ngữ:** nhãn, thông báo, tooltip bằng tiếng Việt (tên tab quốc tế như *Work Order*, *Inventory* giữ tiếng Anh).
- **Mobile / tablet:** ngưỡng ≤ 1024px. Tab dùng bằng máy quét (inbound, outbound, location, stock-check, fg-in, fg-location, nhiệt độ…) **phải có layout mobile thật** (file `*-mobile.scss` hoặc `@media (max-width: 768px)`). Tab chỉ có bảng desktop thì đặt `desktopOnly: true` trong `app-tabs.ts` để menu ẩn trên điện thoại.
- **Màn hình quét:** dùng chung `shared/scan-board.scss` (thanh chế độ, ô quét, danh sách đã scan) để Inbound / Outbound và tab mới giống nhau; dùng `QrScannerModal`, `ScannerInputModal` trong `components/`.
- **Thành phần dùng lại:** `tab-back-button`, `factory-select-dialog` (chọn ASM1/ASM2), `delete-confirmation-dialog`, `print-option-dialog`, `import-progress-dialog`, `storage-unit-picker`, `location-unlock-dialog`. Không tự viết lại dialog tương tự.
- **Gộp nhà máy:** tab dùng chung ASM1 + ASM2 thì dùng một trang có nút chuyển nhà máy (như Inbound, Outbound, Materials), không tạo 2 trang riêng.

### 3.3 Quy ước hiệu năng (đã thấy trong code)

- **Không gọi hàm trong template** (`*ngFor="let x of getFiltered()"`). Tính sẵn vào biến trong `applyFilters()` rồi bind biến (như `fg-check`).
- Bảng lớn dùng **virtual scroll** (CDK) và phân trang; cache kết quả group / sort.
- Danh mục lớn đọc qua service cache (`catalog-cache.service`, `nvl-catalog-full`, `tp-catalog-full`), không đọc lại cả collection ở mỗi trang.
- Lắng nghe Firestore phải `unsubscribe` ở `ngOnDestroy`.

### 3.4 Quy ước phân quyền & an toàn dữ liệu

- Mặc định **không cấp quyền**; chỉ cấp tab trong Settings (collection `user-tab-permissions`), kèm quyền nhà máy qua `FactoryAccessService`.
- Thao tác nguy hiểm (xóa danh mục, mở khóa vị trí, bypass PXK, sửa LSX, mở tồn kho) dùng **OTP** qua Cloud Function; thao tác xóa phải qua `delete-confirmation`.
- Mọi thay đổi dữ liệu quan trọng ghi audit (`audit.service.ts`); xóa dữ liệu ưu tiên xóa mềm / có undo (như `fg-out-undo`, `fg-deleted-docs`).
- Không để công cụ debug / nút dọn dữ liệu hàng loạt trong giao diện người dùng thường.
- Tab công khai (như J Warehouse view) phải là **chỉ đọc** và truyền qua `data: { viewOnly: true }`.

### 3.5 Quy ước thông báo & phát hành

- Thông báo tự động: Zalo (`zalo-notify.util.ts`) và email qua Cloud Functions; cấu hình nằm trong tab Zalo / Settings, không hard-code.
- Mỗi lần deploy phải có `release-notes.txt` để popup "Đã có bản cập nhật mới" hiển thị.
- Chỉ deploy Firebase main (`npm run deploy:hosting`).

### 3.6 Việc nên làm để dự án gọn hơn

1. Xóa/ẩn nhóm ❌ ở mục 2 (sau khi bạn xác nhận).
2. ~~Gom chỗ đăng ký tab về một nguồn~~ — **đã làm 24/10/2026** (`routes/app-tabs.ts`).
3. ~~Tách logic Kiểm kê khỏi `materials.component.ts`~~ — **đã làm 24/10/2026** (`pages/quan-ly-nguyen-lieu/`). Còn lại: tách template + SCSS (hiện 2 component vẫn dùng chung `materials.component.html`).
4. Siết `firestore.rules` cho các collection nhạy cảm.
