# FG Location – Luồng đổi vị trí (cách hiểu)

## Sơ đồ tổng quan

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  BƯỚC 1: Chọn nhà máy                                                        │
│  [ ASM1 ]  [ ASM2 ]                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  BƯỚC 2: Scan vị trí hiện tại                                                │
│  • Một ô scan duy nhất (không còn tick "Đính kèm Pallet ID")                 │
│                                                                              │
│  Cách tìm:                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Scan vị trí CÓ chứa Pallet ID (VD: B6.2-F1-0025)                    │    │
│  │   → Tìm location === "B6.2-F1-0025"                                  │    │
│  │   → Hiển thị TOÀN BỘ mã hàng tại vị trí đó                           │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Scan CHỈ Pallet ID (VD: F1-0025)                                     │    │
│  │   → Tìm theo palletId hoặc location kết thúc bằng "-F1-0025"        │    │
│  │   → Pallet có thể đang gán vị trí khác → vẫn tìm được                │    │
│  │   → Hiển thị mã hàng đang ở pallet ID đó                             │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  [ Scan vị trí hoặc Pallet ID... ]  [ 🔍 Tìm hàng tại vị trí ]              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  BƯỚC 3: Chọn hàng cần di chuyển                                             │
│  📍 Vị trí: B6.2-F1-0025 (n mã hàng)                                        │
│  [✓] Chọn toàn bộ                                                            │
│  [ ] Mã A  ...    [ ] Mã B  ...                                              │
│  [ 📍 Tiếp tục - Scan vị trí mới ]  [ ← Scan vị trí khác ]                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  BƯỚC 4: Scan vị trí mới                                                     │
│  Từ: B6.2-F1-0025  →  Đến: (theo 2 mục bên dưới)                            │
│                                                                              │
│  • Vị trí mới:     [ Scan vị trí mới... ]     [ ☐ Bỏ qua vị trí ]           │
│  • Pallet ID:      [ Scan Pallet ID... ]      [ ☐ Bỏ qua Pallet ID ]        │
│                                                                              │
│  Người dùng có thể:                                                          │
│  – Chỉ scan vị trí mới (tick Bỏ qua Pallet ID)                               │
│  – Chỉ scan Pallet ID (tick Bỏ qua vị trí)                                   │
│  – Scan cả hai                                                                 │
│  → Chỉ cần ít nhất một trong hai có giá trị, sau đó bấm [ Di chuyển ]        │
│                                                                              │
│  [ ✅ Di chuyển ]                                                            │
│  [ ← Quay lại chọn hàng ]                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  BƯỚC 5: Thành công                                                          │
│  Đã di chuyển n mã hàng: B6.2-F1-0025 → [vị trí mới]                         │
│  [ 📍 Scan vị trí khác ]  [ 🏭 Đổi nhà máy ]                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Tóm tắt thay đổi

| Phần | Trước | Sau |
|------|--------|-----|
| Bước 2 | Có tick "Đính kèm Pallet ID" | **Bỏ** hẳn tick; một ô scan, hệ thống tự nhận vị trí hoặc Pallet ID |
| Bước 2 – Scan vị trí có Pallet ID (VD: B6.2-F1-0025) | — | Tìm `location === input` → show toàn bộ mã hàng tại vị trí đó |
| Bước 2 – Scan chỉ Pallet ID (VD: F1-0025) | — | Tìm theo palletId / location ends with "-F1-0025" → show mã hàng đang ở pallet đó (có thể đang ở vị trí khác) |
| Bước 4 | Chỉ khi tick Đính kèm mới có ô Pallet ID; bắt buộc cả hai hoặc không | **Luôn** có 2 mục: Vị trí mới + Pallet ID; mỗi mục có **Bỏ qua**; chỉ cần ít nhất 1 mục có giá trị rồi bấm Di chuyển |

## Công thức "Vị trí mới" khi lưu (bước 4)

- Chỉ **Vị trí mới**: `location` = giá trị scan vị trí mới.
- Chỉ **Pallet ID**: `location` = Pallet ID (pallet có thể chưa có kệ cụ thể).
- **Cả hai**: `location` = `Vị trí mới` + `-` + `Pallet ID` (VD: `B7.1-F1-0030`).
