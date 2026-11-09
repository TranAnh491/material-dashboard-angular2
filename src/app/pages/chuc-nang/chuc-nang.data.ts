/**
 * Nội dung tab "Chức năng" (chỉ admin): mô tả toàn bộ chức năng của phần mềm để admin xem, hiểu.
 * Cập nhật file này khi thêm / đổi chức năng. Danh sách tab + mô tả ngắn lấy tự động từ routes/app-tabs.ts;
 * phần chi tiết bên dưới bổ sung cho các tab chính.
 */

export interface FeatureDetail {
  /** Việc chính làm được ở tab */
  actions: string[];
  /** Dữ liệu ghi vào (collection Firestore) */
  writes?: string[];
  /** Kiểm soát / chặn / OTP */
  controls?: string[];
}

/** Chi tiết theo đường dẫn tab (path trong app-tabs). Tab không có ở đây chỉ hiện mô tả ngắn. */
export const FEATURE_DETAILS: Record<string, FeatureDetail> = {
  '/dashboard': {
    actions: [
      'Bảng tổng quan Work Order theo trạng thái, heatmap LSX, chỉ số vận hành kho.',
      'Cảnh báo kệ (rack warnings) — nút "Chạy" tính lại ngay.',
      'Gửi báo cáo KPI ngay (cùng nội dung báo cáo tự động 8:30 & 17:00).'
    ]
  },
  '/work-order-status': {
    actions: [
      'Import kế hoạch LSX (Excel), theo dõi tình trạng: Waiting → Kitting → Ready → Transfer → Done (+ Ready-IQC, JIT, Delay).',
      'Bấm tiêu đề cột Tình trạng (chữ i) để xem ý nghĩa từng tình trạng.',
      'Import / in PXK, kiểm tra Check lượng (cân bag lẻ), Đủ/Thiếu NVL, Người soạn.',
      'Ready → tự gửi Zalo team soạn chụp hình (Line WHA/WHB/WHG/WHH, USB C); Ready-IQC → Zalo nhóm PLN các mã chờ IQC.'
    ],
    writes: ['work-orders', 'pxk-import-data', 'pxk-weight-checks'],
    controls: [
      'Chỉ chuyển Kitting từ Waiting, Ready từ Kitting, Transfer từ Ready.',
      'Ready / Done phải qua kiểm tra cân PXK.',
      'LSX bị thiếu NVL → Transfer / Done cần OTP Zalo nhóm Quản lý kho (mỗi LSX 1 mã).',
      'LSX chia nhiều lần giao (JIT) chưa giao hết → chuyển Done sẽ tự đổi thành JIT (máy chủ).'
    ]
  },
  '/jit': {
    actions: [
      'Kanban 5 cột: Waiting / Kitting / Ready / Delivering (Transfer) / JIT — không hiện LSX đã Done.',
      'Lọc theo tháng LSX (mặc định tháng hiện tại), nhà máy, khách hàng, Line, tình trạng, khoảng ngày nhận.',
      'Gọi kho lấy hàng (Zalo nhóm Kho), tick Đã lấy lần 1/2/3, hẹn giờ gọi lần sau, Ẩn LSX (tài khoản kho).',
      'Mở LSX → sắp xếp NVL chia lượt giao (Lần 1/2/3), ký nhận bằng quét QR người nhận.',
      'OTD: tỉ lệ LSX Done trước hết ngày nhận.'
    ],
    writes: ['jit-calls', 'jit-call-log', 'jit-product-pattern'],
    controls: ['Đến giờ hẹn → máy chủ tự gọi kho (mỗi 5 phút kiểm tra).']
  },
  '/inbound': {
    actions: [
      'Danh sách lô hàng nhập theo tuần; lọc Trả / Nhập / Đã nhập; tìm lô / DNNK.',
      'Start: QUÉT thẻ nhân viên (không gõ tay, không chọn mã đã lưu) → chọn lô → quét tem từng bịch để nhận.',
      'Đủ số bịch → tự đánh dấu Đã nhận và tạo dòng tồn kho (vị trí IQC, tự tick KK người nhập).',
      'Nhận hàng trả (TRA): quét tem hoặc nhận cả lô sau khi quét thẻ nhân viên.',
      'In tem QR bịch / thùng, In toàn bộ, TBHD, Kiểm 100%, Kiểm tra TBHD.',
      'Chi tiết lô: mã chưa nhận (vạch cam) lên trên, đã nhận (vạch xám, tick xanh) xuống dưới.'
    ],
    writes: ['inbound-materials', 'inventory-materials (dòng tồn mới, mã IB_<id phiếu nhập>)', 'rm-bag-history', 'inventory-kk-history'],
    controls: [
      'Mỗi phiếu nhập chỉ tạo đúng 1 dòng tồn (2 máy cùng nhận / bấm lại không tạo trùng).',
      'Sửa lượng đơn vị đã nhập cần OTP Zalo nhóm Quản lý kho; lệch Standard → gửi mail.'
    ]
  },
  '/outbound': {
    actions: [
      'Quét LSX → quét thẻ nhân viên → quét tem từng bịch theo PXK của LSX.',
      'LSX đang Waiting / Delay / trống → tự chuyển Kitting khi quét LSX.',
      'Xuất BS (bổ sung), xuất thùng (tem thùng), xuất lẻ phần số lẻ của lô, tự xuất mã đầu R theo FIFO.',
      'Lưu: phiếu xuất + trừ tồn kho trong CÙNG 1 lần ghi (cùng thành công / cùng không ghi); lỗi → giữ nguyên danh sách tem để lưu lại.',
      'Tự lưu sau 5 phút nếu quét lâu chưa lưu (tem quét thêm trong lúc lưu vẫn giữ).'
    ],
    writes: ['outbound-materials', 'inventory-materials (exported += lượng xuất)', 'outbound-scan-locks', 'outbound-lsx-log', 'rm-bag-history'],
    controls: [
      'Mã + PO phải có trong PXK của LSX; lượng không vượt phần PXK còn lại; không làm âm tồn.',
      'Tem không có trong tồn / không có PO / lỗi mạng đọc tồn → chặn, bắt quét lại.',
      'Trùng tem: tem đã xuất hoặc đang được LSX khác quét → báo đỏ không cho.',
      'IQC Status nằm trong danh sách cấm (QC rule bật) → chặn; Week ngoài hạn theo khách → chặn.',
      'Bag lẻ mã Check lượng: bag đầu chụp + cân, bag sau chụp hình; tem TL chỉ bắt chụp với mã Check lượng.',
      'Mã Check lượng chưa có Standard packing → chặn quét.',
      'Bag CL lẻ cuối của mã thuộc danh mục Đếm tồn (mặc định B009, B016, B019, B020, B021), tổng tồn < 5000 → bắt đếm lại.'
    ]
  },
  '/materials': {
    actions: [
      'Tồn kho nguyên liệu theo dòng (mã + PO + IMD): tồn = đầu kỳ + nhập − xuất − XT.',
      'Kiểm kê (KK) theo vị trí, tách tem lẻ / in tem lẻ (TL / CL), cân GW.',
      'More: import / xóa / đổi tồn (cần OTP), danh mục ẩn (tự xóa sau N ngày), báo cáo hết stock.'
    ],
    writes: ['inventory-materials', 'inventory-kk-history', 'rm-tem-le-cl', 'rm-tem-le-splits'],
    controls: ['Import / xóa / đổi tồn cần OTP Zalo ASP0106.']
  },
  '/quan-ly-nguyen-lieu': {
    actions: [
      'Kiểm KK theo loại hàng, mã hàng, vị trí; chia kệ × tầng cho B009/B016/B018.',
      'Scan kiểm kê / cập nhật vị trí (cùng màn hình với tab Location).',
      'Link Q: PXK chưa xuất hiện, báo cáo tồn gửi Zalo.'
    ],
    writes: ['inventory-materials', 'inventory-kk-history', 'location-update-sessions']
  },
  '/location': {
    actions: [
      'Đổi vị trí đơn lẻ: quét tem 1 mã → chọn / quét vị trí mới.',
      'Dời kệ: quét vị trí cũ → chọn mã → quét vị trí mới.',
      'Kiểm kê đơn lẻ: quét tem 1 mã → quét vị trí → lưu (đủ lượng tự tick KK).',
      'Kiểm kê cập nhật vị trí: quét vị trí → quét hết tem ở đó → DONE (đủ lượng tự tick KK).',
      'Tìm Locker trống, tra vị trí, lịch sử đổi vị trí, Report cập nhật vị trí; nút ⓘ Giải thích.'
    ],
    writes: ['inventory-materials (location)', 'material-location-history', 'location-update-sessions', 'inventory-kk-history'],
    controls: ['Rule vị trí theo mã (kệ đúng loại hàng); thêm vị trí mới / mở khóa vị trí cần OTP Zalo.']
  },
  '/danh-muc-nvl-tp': {
    actions: [
      'Danh mục NVL & TP: Standard packing, đơn vị, GW bag, Xuất thùng, theo dõi Week, DV lưu trữ.',
      'Tab Check lượng / Cân: mã phải cân, mã thêm, mã không cần cân, tem lẻ không cân, Đếm tồn bag CL, Kiểm 100%.',
      'Rule vị trí theo mã.'
    ],
    writes: ['catalog (NVL)', 'fg-catalog (TP)', 'pxk-weight-check-include / -exempt', 'app-settings/*'],
    controls: ['Xóa toàn bộ danh mục cần OTP Zalo ASP0106.']
  },
  '/aging-report-nvl': { actions: ['Đối chiếu báo cáo tuổi hàng NVL với bảng kê nhập xuất theo PO; tab Cần sửa, sửa / bỏ qua / hoàn tác, xuất Aging đã hiệu chỉnh.'] },
  '/aging-report': { actions: ['Đối chiếu báo cáo tuổi hàng TP với bảng kê nhập xuất; bấm mã TP để xem lot sai ở đâu.'] },
  '/bag-history': {
    actions: ['Control Batch: lịch sử từng bịch nhập / xuất / tồn; lọc trùng xuất, gửi mail báo trùng.'],
    controls: ['Máy chủ quét trùng xuất lúc 12:00 và 17:00, có trùng → email + Zalo ASP0106.']
  },
  '/qc': {
    actions: ['IQC: quét mã nhân viên QA → kiểm từng mã (PASS / NG / Đặc cách…), lấy mẫu, mã ưu tiên, báo cáo tháng, Hold Putaway.'],
    writes: ['inventory-materials (iqcStatus)'],
    controls: ['Chỉ nhân viên bộ phận QA thực hiện IQC.']
  },
  '/fg-in': { actions: ['Nhập thành phẩm vào kho theo lô / LSX / carton; báo "Sai Carton" (mail Kho + Kỹ thuật).'], writes: ['fg-in', 'fg-inventory'] },
  '/fg-out': {
    actions: [
      'Xuất thành phẩm theo shipment: tải tồn theo FIFO, duyệt xuất từng dòng.',
      'Duyệt xuất: trừ tồn FG + ghi fg-export trong CÙNG 1 lần ghi (cộng dồn an toàn khi nhiều máy).',
      'Bỏ duyệt: xóa bản ghi xuất, ghi danh mục hoàn tác (FG Inventory "Refresh" trả lại tồn).'
    ],
    writes: ['fg-out', 'fg-export', 'fg-inventory', 'fg-out-undo']
  },
  '/fg-inventory': {
    actions: ['Tồn kho thành phẩm theo mã / batch / LSX / LOT / vị trí; tính lại cột xuất từ lịch sử; xử lý danh mục hoàn tác.'],
    controls: ['Sửa LOT / LSX cần OTP Zalo ASP0106.']
  },
  '/fg-check': { actions: ['Kiểm tra thành phẩm trước khi xuất; hình tham khảo theo mã TP.'] },
  '/fg-location': { actions: ['Đổi vị trí và nhà máy thành phẩm.'] },
  '/pallet-id': { actions: ['In tem nội bộ kho (pallet ID).'] },
  '/label': { actions: ['In tem nhãn nguyên liệu theo kế hoạch; báo tem trễ kế hoạch (tự động 8:00).'] },
  '/shipment': { actions: ['Kế hoạch và theo dõi giao hàng thành phẩm, in packing / barcode.'] },
  '/nhiet-do': { actions: ['Ghi nhận nhiệt độ kho (có đọc số bằng OCR), nhắc Zalo theo khung giờ.'] },
  '/equipment-checklist': { actions: ['Checklist thiết bị kho, tem QR thiết bị, nhắc Zalo 11:00 và 13:15 nếu còn thiết bị chưa kiểm.'] },
  '/settings': {
    actions: ['Tạo / sửa / xóa tài khoản, đặt lại mật khẩu, cấp quyền tab, quyền Xóa / Sửa.'],
    controls: ['Chỉ admin (custom claim) mới đổi được quyền; mật khẩu mới gửi về Zalo ASP0106.']
  },
  '/zalo': { actions: ['Liên kết mã nhân viên ↔ chat Zalo của bot (nhận OTP, thông báo).'], controls: ['Chỉ admin sửa / xóa liên kết.'] },
  '/chuc-nang': { actions: ['Trang này: liệt kê toàn bộ chức năng, việc tự động và bảo mật để admin xem.'] }
};

/** Quy trình chính, đọc từ trái sang phải. */
export const FLOWS: { name: string; steps: string[] }[] = [
  {
    name: 'Nguyên liệu (RM)',
    steps: [
      'Inbound: nhận lô (quét thẻ NV + tem bịch) → tạo dòng tồn, vị trí IQC',
      'Quality: IQC PASS / NG',
      'Location: cất lên kệ / kiểm kê vị trí',
      'Work Order: import LSX + PXK',
      'Outbound: quét LSX → NV → tem theo PXK → lưu (phiếu xuất + trừ tồn)',
      'JIT: gọi kho giao theo lượt'
    ]
  },
  {
    name: 'Thành phẩm (FG)',
    steps: ['FG In: nhập TP', 'FG Location: xếp vị trí', 'FG Check: kiểm trước xuất', 'FG Out: xuất theo shipment (trừ tồn + fg-export)', 'Shipment: giao hàng']
  }
];

/** Việc máy chủ tự làm (Cloud Functions). */
export const AUTOMATIONS: { when: string; what: string }[] = [
  { when: 'Mỗi 5 phút (24/7)', what: 'JIT: LSX tới giờ hẹn gọi lần sau → tự gọi kho qua Zalo.' },
  { when: 'Khi tồn NVL ghi xuống ≤ −1', what: 'Báo nhóm Zalo Kho kèm LSX + người quét các lần xuất gần nhất.' },
  { when: 'Khi mã B037 đổi khỏi vị trí HOACHAT', what: 'Báo Zalo ngay (sai vị trí hóa chất).' },
  { when: 'Khi Work Order chuyển Done mà JIT chưa giao hết', what: 'Tự đổi tình trạng thành JIT.' },
  { when: 'Khi bấm Gọi ở JIT', what: 'Zalo bot nhắn nhóm Kho lấy hàng cho LSX.' },
  { when: '12:00 và 17:00 hằng ngày', what: 'Quét trùng xuất outbound (Control Batch) → email + Zalo ASP0106 nếu có trùng.' },
  { when: '8:30 và 17:00 (T2–T7)', what: 'Báo cáo KPI Dashboard qua email + Zalo.' },
  { when: '8:00 hằng ngày', what: 'Tính cảnh báo kệ; báo tem trễ kế hoạch; email mã tách bag CL có GW lệch > 5%.' },
  { when: '8:00 (T2–T7)', what: 'Báo hóa chất sai vị trí (tổng hợp).' },
  { when: '6:00 hằng ngày', what: 'Buộc đăng xuất mọi phiên (force logout).' },
  { when: 'Mỗi 5 phút 8–10h, 14–16h (T2–T7)', what: 'Nhắc ghi nhiệt độ qua Zalo.' },
  { when: '11:00 và 13:15 (T2–T7)', what: 'Nhắc kiểm tra thiết bị kho chưa kiểm.' },
  { when: '9h, 12h, 15h, 17h (T3, T5, T6, T7)', what: 'Báo hàng nhập quá hạn chưa xử lý qua Zalo.' },
  { when: '8:00 thứ Sáu', what: 'Báo FG Overview thiếu import.' },
  { when: '8:00 thứ Hai', what: 'Email báo cáo Hold Putaway hằng tuần.' },
  { when: '8:00 ngày 1 hằng tháng', what: 'Báo cáo QC tháng.' },
  { when: '1:00 hằng ngày', what: 'Sao lưu dữ liệu FG.' },
  { when: '3:00 thứ Hai', what: 'Sao lưu dữ liệu NVL (file trên Storage, chỉ máy chủ đọc được).' },
  { when: '2:00 hằng ngày', what: 'Xóa hẳn dòng tồn trong danh mục Ẩn đã quá hạn.' },
  { when: '2:30 hằng ngày', what: 'Xóa hình bag lẻ đã cân cũ hơn 6 tháng.' },
  { when: '7:00 hằng ngày', what: 'Dọn LSX bổ sung (BS) cũ.' },
  { when: 'Sau mỗi lần deploy', what: 'Gửi lệnh tải lại + ghi chú chức năng mới tới mọi máy đang mở.' }
];

/** Bảo mật & quyền — tóm tắt để admin nắm. */
export const SECURITY: { item: string; detail: string }[] = [
  { item: 'Admin', detail: 'Quyền admin là custom claim do máy chủ gán (chỉ ASP0106), không sửa được từ trình duyệt.' },
  { item: 'Đăng nhập mật khẩu', detail: 'Mã ASP + mật khẩu 6 số; mật khẩu mới / đặt lại gửi về Zalo ASP0106 hoặc email công ty.' },
  { item: 'Đăng nhập quét thẻ', detail: 'Thẻ chỉ có mã ASP. Quét sai > 20 lần / 15 phút từ cùng mạng → khóa 15 phút + báo Zalo admin (chống dò mã). Admin không đăng nhập được bằng thẻ.' },
  { item: 'Tài khoản Xe Tải', detail: 'ASP9999 / XETAI, mật khẩu chung lưu ở máy chủ (secret TRUCK_DRIVER_PASSWORD), không còn ghi trong mã nguồn.' },
  { item: 'OTP Zalo', detail: 'Mở khóa / thêm vị trí, xóa danh mục, sửa tồn RM, sửa LĐV inbound, vượt PXK thiếu, sửa LOT/LSX FG. Mã OTP chỉ máy chủ đọc được.' },
  { item: 'Quyền tab', detail: 'Mỗi tài khoản được cấp từng tab trong Settings; tab Admin cần thêm vai trò Admin / Quản lý.' },
  { item: 'Lưu ý', detail: 'Ngoài các collection có luật riêng, tài khoản đã đăng nhập vẫn đọc / ghi được phần lớn dữ liệu kho — quyền tab chủ yếu chặn trên giao diện.' }
];
