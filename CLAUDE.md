# Quy tắc dự án Airspeed Warehouse

## Giao diện — khi tạo tab / trang mới

1. **Nút Home / Menu / Back đồng bộ thiết kế**
   - Mỗi trang tự đặt nút **Back** và **Menu** trong thanh nút của trang (đầu trang), cùng kiểu với các nút khác:
     hình chữ nhật bo góc, cao **36px**, chữ + icon (`arrow_back` Back, `home` Menu).
   - **Không dùng nút icon tròn** (kiểu nút Home tròn nổi của thanh hệ thống).
2. **Không đè lên nút khác**
   - Trang có thanh nút riêng → đặt cờ `hideNavbar: true` cho tab trong `src/app/routes/app-tabs.ts`
     để ẩn thanh hệ thống / nút Home nổi (route không phải tab: thêm vào `HIDE_NAVBAR_PATHS` cùng file).
   - Trang mới: dùng `<app-page-toolbar>` (src/app/shared/page-toolbar) — có sẵn Back / Menu đúng chuẩn.
   - Thông báo: dùng `appAlert()` / `appToast()` (src/app/shared/app-toast.ts), không dùng `alert()`.
   - Màu / font: dùng biến `--app-*` trong `src/styles.css`; bảng kiểu Excel: class `xl-table`.
   - Tab trong `src/app/routes/app-tabs.ts` có thanh nút riêng → đặt cờ `ownNav: true`.
   - Không dùng `<app-tab-back-button variant="floating">` cho trang đã có thanh nút ở góc phải trên.
3. **Vùng trên cùng (hover / thanh hệ thống) không được che dàn nút thao tác**
   - Không để lớp trong suốt hoặc vùng hover của navbar nằm đè lên hàng nút đầu trang;
     mọi nút ở đầu trang phải bấm được.
4. **Hàng nút đồng đều, ngang hàng**
   - Mọi nút trong một hàng cùng chiều cao, bo góc, cỡ chữ; căn giữa theo chiều dọc; chia nhóm theo chức năng.
5. **Nút gọn, ít, một dòng**
   - Các nút **không được đè lên nhau**, luôn xếp gọn gàng.
   - Càng ít nút càng tốt: gom chức năng phụ vào menu (More / Thao tác) thay vì thêm nút mới.
   - Ưu tiên gom về **1 dòng**; các nút phải **ngang hàng, cùng size, cùng tone màu** (không mỗi nút một màu).
6. **Giao diện kiểu Excel**
   - Bảng dữ liệu kẻ ô xám, tiêu đề cột nền xám nhạt, chữ gọn, ít màu, không bóng đổ / gradient
     (mẫu: tab Danh mục NVL & TP, Quản lý nguyên liệu, Outbound).

## Deploy

- Chỉ deploy khi người dùng nói "deploy".
- Trước mỗi lần deploy hosting: viết `release-notes.txt` (tiếng Việt, mỗi dòng 1 thay đổi) rồi chạy `npm run deploy:hosting`.
