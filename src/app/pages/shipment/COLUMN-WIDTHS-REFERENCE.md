# Chiều rộng các cột bảng Shipment – Tham chiếu

**File quy định:** `src/app/pages/shipment/shipment.component.css`

Cột được đánh số theo thứ tự trong HTML (th = td). Có **2 nơi** quy định chiều rộng:

1. **Class trên ô** (áp cho từng `<td>`): đoạn "Cell Types" (~dòng 595–708).
2. **`.table th:nth-child(n), .table td:nth-child(n)`**: đoạn "Cột tự mở rộng..." (~dòng 732–759).  
   **Lưu ý:** Comment trong code hiện sai từ cột 7 trở đi (thiếu cột CHECK). Bảng dưới đây là đúng theo HTML.

---

## Bảng: Tên cột ↔ nth-child ↔ Chiều rộng hiện tại ↔ Nơi quy định

| # | Tên cột        | nth-child | min-width hiện tại | Class trên td        | Vị trí trong CSS |
|---|----------------|-----------|--------------------|------------------------|------------------|
| 1 | NO             | 1         | 56px               | .row-header            | .row-header: 60px; nth-child(1): 56px |
| 2 | NGÀY IMPORT    | 2         | 120px              | (không class)          | nth-child(2): 120px |
| 3 | BIỂN SỐ XE     | 3         | 105px              | (không class)          | nth-child(3): 105px |
| 4 | FACTORY        | 4         | 86px               | (không class)          | nth-child(4): 86px |
| 5 | SHIPMENT       | 5         | 110px              | .code-cell             | .code-cell: 120px; nth-child(5): 110px |
| 6 | LƯỢNG KTRA     | 6         | 90px               | .check-cell            | .check-cell: 72px; nth-child(6): 90px |
| 7 | CHECK          | 7         | 110px **(sai)**    | .check-status-cell     | .check-status-cell: 48px; nth-child(7): **110px (đang ghi MÃ TP)** |
| 8 | MÃ TP          | 8         | 155px **(sai)**    | .code-cell             | .code-cell: 120px; nth-child(8): **155px (đang ghi MÃ KHÁCH)** |
| 9 | MÃ KHÁCH       | 9         | 110px **(sai)**    | .customer-cell         | .customer-cell: 169px; nth-child(9): **110px (đang ghi LƯỢNG XUẤT)** |
| 10| LƯỢNG XUẤT     | 10        | 232px **(sai)**    | .number-cell           | .number-cell: 104px; nth-child(10): **232px (đang ghi PO SHIP)** |
| 11| PO SHIP        | 11        | 92px **(sai)**     | .poship-cell           | .poship-cell: 270px; nth-child(11): **92px (đang ghi CARTON)** |
| 12| CARTON         | 12        | **100px (sai)**    | .number-cell           | nth-child(12): **100px – đây là CARTON, không phải QTYBOX** |
| 13| QTYBOX         | 13        | **67px (sai)**     | .number-cell .qtybox-cell | .qtybox-cell: 100px; nth-child(13): **67px (đang ghi ODD)** |
| 14| ODD            | 14        | 96px               | .number-cell           | nth-child(14): 96px |
| 15| TỒN KHO        | 15        | 86px               | .number-cell           | nth-child(15): 86px |
| 16| FWD            | 16        | 86px               | (không class)          | nth-child(16): 86px |
| 17| PACKING        | 17        | 96px               | (không class)          | nth-child(17): 96px |
| 18| QTY PALLET     | 18        | 127px              | .number-cell           | nth-child(18): 127px |
| 19| STATUS         | 19        | 98px               | .status-cell           | .status-cell: 96px; nth-child(19): 98px |
| 20| CHỨNG TỪ      | 20        | 115px              | (không class)          | nth-child(20): 115px |
| 21| CS DATE        | 21        | 115px              | .date-cell             | .date-cell: 104px; nth-child(21): 115px |
| 22| FULL DATE      | 22        | 132px              | .date-cell             | nth-child(22): 132px |
| 23| DISPATCH DATE  | 23        | 96px               | .date-cell             | nth-child(23): 96px |
| 24| NGÀY CHUẨN BỊ | 24        | 145px              | .number-cell           | nth-child(24): 145px |
| 25| GHI CHÚ        | 25        | 67px               | .notes-cell            | .notes-cell: 156px; nth-child(25): 67px **(nth-child ghi PRINT)** |
| 26| PRINT          | 26        | 67px               | .action-cell           | nth-child(26): 67px |
| 27| XÓA            | 27        | 67px               | .action-cell           | nth-child(27): 67px |
| 28| ẨN             | 28        | 64px               | .action-cell .col-hidden-cell | .table th:last-child: 64px |

---

## Kết luận

- **Cột QTYBOX** là **nth-child(13)** (và có class `.qtybox-cell`).
- Trong CSS, **nth-child(12)** đang được comment là "QTYBOX" nhưng thực tế là **CARTON**; **nth-child(13)** mới là **QTYBOX** (comment đang ghi "ODD").
- Việc tăng "QTYBOX" lên 100px đã áp vào **nth-child(12)** nên **CARTON** bị rộng 100px, còn **QTYBOX (nth-child 13)** vẫn 67px.

**Cần sửa:**  
- Cột **QTYBOX**: chỉnh **nth-child(13)** (và giữ .qtybox-cell) thành 100px.  
- Cột **CARTON**: trả **nth-child(12)** về 92px và sửa comment cho đúng tên cột.
