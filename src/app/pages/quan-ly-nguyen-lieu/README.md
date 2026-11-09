# Quản lý Nguyên Liệu (`/quan-ly-nguyen-lieu`)

Tab Kiểm tra KK, tách khỏi RM Inventory (`/materials`) ngày 24/10/2026.

## Cấu trúc

| File | Nội dung |
|---|---|
| `quan-ly-nguyen-lieu.component.ts` | `QuanLyNguyenLieuComponent extends MaterialsComponent`: toàn bộ logic chỉ dùng cho Kiểm kê |
| `quan-ly-nguyen-lieu.module.ts` | Module lazy-load riêng (route trong `admin-layout.routing.ts`) |
| `../materials/materials.component.ts` | Phần dùng chung: tồn kho, danh mục, nhà máy, tick KK trên Inventory, popup dùng chung |
| `../materials/materials.component.html` + `.scss` | **Vẫn dùng chung** cho cả 2 component |

## Quy ước khi sửa

- Logic chỉ phục vụ trang Kiểm kê → viết trong `quan-ly-nguyen-lieu.component.ts`.
- RM Inventory gọi sang Kiểm kê qua hook ở lớp cha, lớp con ghi đè:
  `initKkPage()` (cuối `ngOnInit`), `onKkPageFactoryChanged()`, `onKkPageResize()`, `openKkLocMapFromMore()`.
- `isNguyenLieuPage` = `false` ở `MaterialsComponent`, `true` ở lớp con (không còn đọc URL).
- Biến dùng trong điều kiện `*ngIf` **ngoài cùng** của template phải khai báo ở `MaterialsComponent`
  (AOT kiểm tra template cho cả 2 component). Biến/hàm chỉ dùng bên trong khối KK thì để ở lớp con được.
- Member của lớp cha mà lớp con cần dùng phải là `protected` (không `private`).
