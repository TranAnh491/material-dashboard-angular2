/**
 * NGUỒN DUY NHẤT đăng ký tab của app.
 *
 * Thêm tab mới: thêm 1 dòng vào APP_TABS (+ route trong admin-layout.routing.ts).
 * Muốn hiện trên sidebar thì thêm path vào SIDEBAR_LAYOUT bên dưới.
 * Mọi nơi khác (Menu, Dashboard mobile, sidebar, TabPermissionGuard, popup quyền trong Settings,
 * chặn tab chỉ-desktop trên mobile, nút "Về Menu" của navbar) đều đọc từ file này.
 */

export type MenuCategory =
  | 'Main'
  | 'Production'
  | 'Stock Check'
  | 'RM'
  | 'Quality'
  | 'ASM FG'
  | 'Tools'
  | 'Report'
  | 'Admin';

/** Nhóm trong popup cấp quyền tab (Settings). */
export type PermissionGroup = 'Chính' | 'RM' | 'FG' | 'Khác';

export interface AppTab {
  /** Đường dẫn route, vd '/inbound' */
  path: string;
  /** Key quyền trong `user-tab-permissions`; null = chỉ cần đăng nhập (không qua TabPermissionGuard) */
  key: string | null;
  title: string;
  /** Mô tả ngắn trên thẻ Menu / Dashboard mobile */
  subtitle?: string;
  /** Hiện trên Menu (thẻ) */
  menu?: { category: MenuCategory; icon: string; iconImage: string };
  /** Icon trên sidebar (chỉ dùng khi path có trong SIDEBAR_LAYOUT) */
  sidebarIcon?: string;
  /** Hiện trên lưới module của Dashboard mobile */
  dashboard?: { category: MenuCategory; icon: string };
  /** Hiện trong popup cấp quyền tab của Settings (mỗi key chỉ khai báo ở 1 tab) */
  permission?: { name: string; group: PermissionGroup };
  /** Chưa có giao diện mobile/tablet: ẩn khỏi Menu trên mobile và guard chuyển về Menu */
  desktopOnly?: boolean;
  /** Trang tự có nút Back / Về Menu: navbar ẩn nút "Về Menu" nổi */
  ownNav?: boolean;
  /** Chỉ Admin / Quản lý (ngoài tab permission) */
  adminOnly?: boolean;
}

/** Thứ tự = thứ tự hiển thị trên Menu (trong từng nhóm). */
export const APP_TABS: AppTab[] = [
  // ── Main ──
  {
    path: '/dashboard', key: 'dashboard', title: 'Dashboard',
    subtitle: 'Bảng tổng quan và chỉ số vận hành',
    menu: { category: 'Main', icon: 'speed', iconImage: 'assets/img/dasboard.png' },
    sidebarIcon: 'dashboard',
    permission: { name: 'Dashboard', group: 'Chính' },
    ownNav: true,
  },
  {
    path: '/work-order-status', key: 'work-order-status', title: 'Work Order',
    subtitle: 'Theo dõi trạng thái lệnh sản xuất',
    menu: { category: 'Main', icon: 'description', iconImage: 'assets/img/workorder.png' },
    sidebarIcon: 'assignment',
    dashboard: { category: 'Main', icon: 'assignment' },
    permission: { name: 'Work Order', group: 'Chính' },
    desktopOnly: true,
  },
  {
    path: '/shipment', key: 'shipment', title: 'Shipment',
    subtitle: 'Kế hoạch và theo dõi giao hàng',
    menu: { category: 'Main', icon: 'local_shipping', iconImage: 'assets/img/shipment.png' },
    sidebarIcon: 'local_shipping',
    dashboard: { category: 'Main', icon: 'local_shipping' },
    permission: { name: 'Shipment', group: 'Chính' },
    desktopOnly: true, ownNav: true,
  },
  {
    path: '/location', key: 'location', title: 'Materials',
    subtitle: 'Đổi vị trí cho toàn bộ nguyên vật liệu',
    menu: { category: 'Main', icon: 'inventory_2', iconImage: 'assets/img/location.png' },
    sidebarIcon: 'inventory_2',
    dashboard: { category: 'Main', icon: 'inventory_2' },
    permission: { name: 'Materials', group: 'Khác' },
    ownNav: true,
  },
  {
    path: '/danh-muc-nvl-tp', key: 'danh-muc-nvl-tp', title: 'Danh Mục',
    subtitle: 'Quản lý danh mục NVL & TP',
    menu: { category: 'Main', icon: 'menu_book', iconImage: 'assets/img/rminventory.png' },
    permission: { name: 'Danh mục NVL & TP', group: 'RM' },
    desktopOnly: true, ownNav: true,
  },
  {
    path: '/j-warehouse', key: 'j-warehouse', title: 'J Warehouse',
    subtitle: 'Sơ đồ kho J — 105m × 30m',
    menu: { category: 'Main', icon: 'warehouse', iconImage: 'assets/img/location.png' },
    sidebarIcon: 'warehouse',
    permission: { name: 'J Warehouse', group: 'Khác' },
    desktopOnly: true, ownNav: true,
  },

  // ── Report ──
  {
    path: '/report', key: 'report', title: 'Report',
    subtitle: 'Báo cáo và phân tích',
    menu: { category: 'Report', icon: 'analytics', iconImage: 'assets/img/dasboard.png' },
    sidebarIcon: 'analytics',
    dashboard: { category: 'Report', icon: 'analytics' },
    permission: { name: 'Report', group: 'Khác' },
    desktopOnly: true, ownNav: true,
  },
  {
    path: '/shorted-materials', key: 'shorted-materials', title: 'Shorted materials',
    subtitle: 'Theo dõi nguyên liệu bị thiếu',
    menu: { category: 'Report', icon: 'difference', iconImage: 'assets/img/dasboard.png' },
    sidebarIcon: 'difference',
    dashboard: { category: 'Report', icon: 'difference' },
    permission: { name: 'Shorted materials', group: 'Khác' },
    desktopOnly: true, ownNav: true,
  },

  // ── Production ──
  {
    path: '/pd-control', key: 'pd-control', title: 'PD Control',
    subtitle: 'Giám sát điều khiển sản xuất',
    menu: { category: 'Production', icon: 'precision_manufacturing', iconImage: 'assets/img/analytics.png' },
    sidebarIcon: 'precision_manufacturing',
    dashboard: { category: 'Production', icon: 'precision_manufacturing' },
    permission: { name: 'PD Control', group: 'Chính' },
    ownNav: true,
  },

  // ── RM (trang gộp dùng chung ASM1 + ASM2, nút chuyển nhà máy trong trang) ──
  {
    path: '/inbound', key: 'inbound', title: 'RM Inbound',
    subtitle: 'Nhập kho nguyên liệu (ASM1 & ASM2)',
    menu: { category: 'RM', icon: 'download', iconImage: 'assets/img/rmin.png' },
    sidebarIcon: 'IB',
    dashboard: { category: 'RM', icon: 'arrow_downward' },
    permission: { name: 'RM Inbound (ASM1 + ASM2)', group: 'RM' },
    ownNav: true,
  },
  {
    path: '/outbound', key: 'outbound', title: 'RM Outbound',
    subtitle: 'Xuất kho nguyên liệu (ASM1 & ASM2)',
    menu: { category: 'RM', icon: 'upload', iconImage: 'assets/img/rmout.png' },
    sidebarIcon: 'OB',
    dashboard: { category: 'RM', icon: 'arrow_upward' },
    permission: { name: 'RM Outbound (ASM1 + ASM2)', group: 'RM' },
    ownNav: true,
  },
  {
    path: '/materials', key: 'materials', title: 'RM Inventory',
    subtitle: 'Quản lý tồn kho nguyên liệu (ASM1 & ASM2)',
    menu: { category: 'RM', icon: 'warehouse', iconImage: 'assets/img/rminventory.png' },
    sidebarIcon: 'IV',
    dashboard: { category: 'RM', icon: 'inventory' },
    permission: { name: 'RM Inventory (ASM1 + ASM2)', group: 'RM' },
    ownNav: true,
  },
  {
    // Cùng module với /materials, dùng chung quyền 'materials'
    path: '/quan-ly-nguyen-lieu', key: 'materials', title: 'Quản lý Nguyên Liệu',
    subtitle: 'Kiểm tra KK theo loại hàng, mã hàng và vị trí',
    menu: { category: 'RM', icon: 'fact_check', iconImage: 'assets/img/shipcheck.png' },
    sidebarIcon: 'QL',
    dashboard: { category: 'RM', icon: 'fact_check' },
    ownNav: true,
  },
  {
    path: '/inventory-overview', key: 'inventory-overview', title: 'RM Overview',
    subtitle: 'Xem tổng quan tồn kho (ASM1 & ASM2)',
    menu: { category: 'RM', icon: 'bar_chart', iconImage: 'assets/img/stocktaking.png' },
    sidebarIcon: 'IO',
    dashboard: { category: 'RM', icon: 'assessment' },
    permission: { name: 'RM Overview (ASM1 + ASM2)', group: 'RM' },
    desktopOnly: true, ownNav: true,
  },
  {
    path: '/bag-history', key: 'bag-history', title: 'Control Batch',
    subtitle: 'Kiểm soát batch và bịch xuất',
    menu: { category: 'RM', icon: 'history', iconImage: 'assets/img/traceback.png' },
    sidebarIcon: 'H',
    dashboard: { category: 'RM', icon: 'history' },
    permission: { name: 'Control Batch', group: 'RM' },
  },
  {
    path: '/label', key: 'label', title: 'Label',
    subtitle: 'In tem nhãn nguyên liệu',
    menu: { category: 'RM', icon: 'local_offer', iconImage: 'assets/img/label.png' },
    sidebarIcon: 'label',
    dashboard: { category: 'Tools', icon: 'label' },
    permission: { name: 'Label', group: 'Khác' },
    desktopOnly: true, ownNav: true,
  },

  // ── Quality ──
  {
    path: '/qc', key: 'qc', title: 'Quality',
    subtitle: 'Kiểm tra chất lượng nguyên liệu',
    menu: { category: 'Quality', icon: 'verified', iconImage: 'assets/img/qc.png' },
    sidebarIcon: 'assignment_turned_in',
    dashboard: { category: 'Quality', icon: 'verified' },
    permission: { name: 'Quality', group: 'Khác' },
    desktopOnly: true, ownNav: true,
  },
  {
    path: '/nhiet-do', key: 'nhiet-do', title: 'Nhiệt Độ',
    subtitle: 'Ghi nhận và theo dõi nhiệt độ',
    menu: { category: 'Quality', icon: 'thermostat', iconImage: 'assets/img/qc.png' },
    sidebarIcon: 'thermostat',
    permission: { name: 'Nhiệt Độ', group: 'Khác' },
    ownNav: true,
  },
  {
    path: '/equipment-checklist', key: 'equipment-checklist', title: 'Quản lý thiết bị',
    subtitle: 'Checklist thiết bị kho, tem QR và nhắc Zalo',
    menu: { category: 'Quality', icon: 'precision_manufacturing', iconImage: 'assets/img/qc.png' },
    sidebarIcon: 'precision_manufacturing',
    dashboard: { category: 'Quality', icon: 'precision_manufacturing' },
    permission: { name: 'Quản lý thiết bị', group: 'Khác' },
    ownNav: true,
  },
  {
    // Dùng chung quyền 'qc'
    path: '/qc-traceability', key: 'qc', title: 'Traceability',
    subtitle: 'Truy xuất nguồn gốc nguyên liệu',
    menu: { category: 'Quality', icon: 'timeline', iconImage: 'assets/img/traceback.png' },
    sidebarIcon: 'timeline',
    dashboard: { category: 'Quality', icon: 'timeline' },
    desktopOnly: true, ownNav: true,
  },

  // ── ASM FG ──
  {
    path: '/fg-in', key: 'fg-in', title: 'FG In',
    subtitle: 'Nhập thành phẩm vào kho',
    menu: { category: 'ASM FG', icon: 'input', iconImage: 'assets/img/fgin.png' },
    sidebarIcon: 'move_to_inbox',
    dashboard: { category: 'ASM FG', icon: 'input' },
    permission: { name: 'FG In', group: 'FG' },
    ownNav: true,
  },
  {
    path: '/fg-out', key: 'fg-out', title: 'FG Out',
    subtitle: 'Xuất thành phẩm',
    menu: { category: 'ASM FG', icon: 'output', iconImage: 'assets/img/fgout.png' },
    sidebarIcon: 'outbox',
    dashboard: { category: 'ASM FG', icon: 'output' },
    permission: { name: 'FG Out', group: 'FG' },
    desktopOnly: true, ownNav: true,
  },
  {
    path: '/fg-check', key: 'fg-check', title: 'FG Check',
    subtitle: 'Kiểm tra thành phẩm trước khi xuất',
    menu: { category: 'ASM FG', icon: 'fact_check', iconImage: 'assets/img/shipcheck.png' },
    sidebarIcon: 'fact_check',
    dashboard: { category: 'ASM FG', icon: 'fact_check' },
    permission: { name: 'FG Check', group: 'FG' },
  },
  {
    path: '/fg-inventory', key: 'fg-inventory', title: 'FG Inventory',
    subtitle: 'Quản lý tồn kho thành phẩm',
    menu: { category: 'ASM FG', icon: 'inventory_2', iconImage: 'assets/img/fginventory.png' },
    sidebarIcon: 'inventory',
    dashboard: { category: 'ASM FG', icon: 'inventory_2' },
    permission: { name: 'FG Inventory', group: 'FG' },
    desktopOnly: true, ownNav: true,
  },
  {
    // Trang con của FG Inventory, dùng chung quyền
    path: '/fg-inventory/tp-list', key: 'fg-inventory', title: 'FG Inventory',
    desktopOnly: true, ownNav: true,
  },
  {
    path: '/fg-overview', key: 'fg-overview', title: 'FG Overview',
    subtitle: 'Tổng quan tồn kho thành phẩm',
    menu: { category: 'ASM FG', icon: 'table_chart', iconImage: 'assets/img/stocktaking.png' },
    sidebarIcon: 'table_chart',
    dashboard: { category: 'ASM FG', icon: 'table_chart' },
    permission: { name: 'FG Overview', group: 'FG' },
    desktopOnly: true,
  },
  {
    path: '/fg-location', key: 'fg-location', title: 'FG Location',
    subtitle: 'Đổi vị trí và nhà máy thành phẩm',
    menu: { category: 'ASM FG', icon: 'edit_location', iconImage: 'assets/img/fglocation.png' },
    sidebarIcon: 'location_on',
    dashboard: { category: 'ASM FG', icon: 'edit_location' },
    permission: { name: 'FG Location', group: 'FG' },
    ownNav: true,
  },
  {
    path: '/pallet-id', key: 'pallet-id', title: 'In tem nội bộ',
    subtitle: 'In tem nội bộ kho',
    menu: { category: 'ASM FG', icon: 'print', iconImage: 'assets/img/palletid.png' },
    sidebarIcon: 'print',
    dashboard: { category: 'ASM FG', icon: 'print' },
    permission: { name: 'In tem nội bộ', group: 'FG' },
    desktopOnly: true,
  },

  // ── Tools ──
  {
    path: '/lich-lam-viec', key: 'lich-lam-viec', title: 'Lịch Làm Việc',
    subtitle: 'Phân công tuần: soạn LSX, nhận NVL, giao LSX theo nhóm',
    menu: { category: 'Tools', icon: 'event_note', iconImage: 'assets/img/workorder.png' },
    sidebarIcon: 'event_note',
    dashboard: { category: 'Main', icon: 'event_note' },
    permission: { name: 'Lịch Làm Việc', group: 'Chính' },
    ownNav: true,
  },
  {
    path: '/materials-dashboard', key: 'materials-dashboard', title: 'Materials Dashboard',
    subtitle: 'Bảng tổng hợp nguyên vật liệu',
    menu: { category: 'Tools', icon: 'grid_view', iconImage: 'assets/img/dasboard.png' },
    sidebarIcon: 'grid_view',
    dashboard: { category: 'Tools', icon: 'grid_view' },
    permission: { name: 'Materials Dashboard', group: 'Chính' },
    desktopOnly: true,
  },
  {
    path: '/rm1-delivery', key: 'rm1-delivery', title: 'RM Delivery',
    subtitle: 'Giao nguyên liệu cho sản xuất',
    menu: { category: 'Tools', icon: 'local_shipping', iconImage: 'assets/img/delivery.png' },
    sidebarIcon: 'local_shipping',
    dashboard: { category: 'Tools', icon: 'local_shipping' },
    permission: { name: 'RM Delivery', group: 'Khác' },
    ownNav: true,
  },
  {
    // Ai đăng nhập cũng dùng được
    path: '/xe-tai', key: null, title: 'Xe Tải',
    menu: { category: 'Tools', icon: 'local_shipping', iconImage: 'assets/img/shipment.png' },
    sidebarIcon: 'local_shipping',
    ownNav: true,
  },
  {
    path: '/fgs-dashboard', key: 'fgs-dashboard', title: 'FGs Dashboard',
    subtitle: 'Bảng tổng hợp thành phẩm',
    menu: { category: 'Tools', icon: 'grid_view', iconImage: 'assets/img/dasboard.png' },
    sidebarIcon: 'grid_view',
    dashboard: { category: 'Tools', icon: 'grid_view' },
    permission: { name: 'FGs Dashboard', group: 'Chính' },
    desktopOnly: true,
  },
  {
    path: '/stock-check', key: 'stock-check', title: 'Stock Check',
    subtitle: 'Quét vị trí, kiểm mã và lượng tồn',
    menu: { category: 'Stock Check', icon: 'checklist', iconImage: 'assets/img/shipcheck.png' },
    sidebarIcon: 'checklist',
    dashboard: { category: 'Tools', icon: 'inventory_2' },
    permission: { name: 'Stock Check', group: 'Khác' },
  },
  {
    path: '/bieu-mau', key: 'bieu-mau', title: 'Biểu mẫu',
    subtitle: 'Phiếu xuất kho, biểu mẫu 5S',
    menu: { category: 'Tools', icon: 'description', iconImage: 'assets/img/workorder.png' },
    sidebarIcon: 'description',
    permission: { name: 'Biểu mẫu', group: 'Khác' },
  },

  // ── Admin ──
  {
    path: '/index', key: 'index', title: 'Bonded Report',
    subtitle: 'Báo cáo kho ngoại quan',
    sidebarIcon: 'analytics',
    dashboard: { category: 'Admin', icon: 'analytics' },
    permission: { name: 'Bonded Report', group: 'Khác' },
    desktopOnly: true,
  },
  {
    path: '/sxxk', key: 'sxxk', title: 'SXXK',
    subtitle: 'Quản lý sản xuất xuất khẩu',
    menu: { category: 'Admin', icon: 'inventory_2', iconImage: 'assets/img/sxxk.png' },
    sidebarIcon: 'inventory_2',
    dashboard: { category: 'Admin', icon: 'inventory_2' },
    permission: { name: 'SXXK', group: 'Khác' },
    desktopOnly: true,
  },
  {
    path: '/scrap', key: 'scrap', title: 'Scrap',
    subtitle: 'Quản lý phế liệu',
    menu: { category: 'Admin', icon: 'delete_sweep', iconImage: 'assets/img/scrap.png' },
    dashboard: { category: 'Admin', icon: 'delete_sweep' },
    permission: { name: 'SCRAP', group: 'Khác' },
    ownNav: true,
  },
  {
    path: '/checklist', key: 'checklist', title: 'Safety & Quality',
    subtitle: 'An toàn và chất lượng',
    menu: { category: 'Admin', icon: 'check_circle', iconImage: 'assets/img/safety.png' },
    sidebarIcon: 'checklist',
    dashboard: { category: 'Admin', icon: 'checklist' },
    permission: { name: 'Safety & Quality', group: 'Khác' },
    desktopOnly: true,
  },
  {
    path: '/equipment', key: 'equipment', title: 'Training',
    subtitle: 'Đào tạo nhân viên kho',
    menu: { category: 'Admin', icon: 'school', iconImage: 'assets/img/training.png' },
    sidebarIcon: 'integration_instructions',
    dashboard: { category: 'Admin', icon: 'integration_instructions' },
    permission: { name: 'Training', group: 'Khác' },
    desktopOnly: true, ownNav: true,
  },
  {
    // Ai đăng nhập cũng dùng được
    path: '/tai-khoan', key: null, title: 'Quản lý tài khoản',
    subtitle: 'Đổi tên và mật khẩu của tài khoản đang đăng nhập',
    menu: { category: 'Admin', icon: 'manage_accounts', iconImage: 'assets/img/setting.png' },
  },
  {
    path: '/settings', key: 'settings', title: 'Settings',
    subtitle: 'Cài đặt tài khoản và phân quyền',
    menu: { category: 'Admin', icon: 'settings', iconImage: 'assets/img/setting.png' },
    sidebarIcon: 'settings',
    dashboard: { category: 'Admin', icon: 'settings' },
    permission: { name: 'Settings', group: 'Khác' },
    desktopOnly: true, ownNav: true, adminOnly: true,
  },
  {
    path: '/zalo', key: 'zalo', title: 'Zalo',
    subtitle: 'Tích hợp thông báo Zalo',
    menu: { category: 'Admin', icon: 'chat', iconImage: 'assets/img/setting.png' },
    sidebarIcon: 'chat',
    dashboard: { category: 'Admin', icon: 'chat' },
    permission: { name: 'Zalo', group: 'Khác' },
    desktopOnly: true, adminOnly: true,
  },
];

/** Bố cục sidebar: path = 1 mục; object = nhóm có mục con. */
type SidebarGroup = { title: string; icon: string; class: string; childClass: string; children: string[] };
export const SIDEBAR_LAYOUT: Array<string | SidebarGroup> = [
  '/dashboard',
  '/pd-control',
  '/work-order-status',
  '/lich-lam-viec',
  '/shipment',
  '/stock-check',
  {
    title: 'RM', icon: 'inventory', class: 'asm1-rm-parent', childClass: '',
    children: ['/inbound', '/outbound', '/materials', '/quan-ly-nguyen-lieu', '/inventory-overview', '/bag-history'],
  },
  {
    title: 'ASM FG', icon: 'check_circle_outline', class: 'asm1-fg-parent', childClass: 'material-child-icon',
    children: ['/fg-in', '/fg-out', '/fg-check', '/fg-inventory', '/fg-overview', '/fg-location', '/pallet-id'],
  },
  {
    title: 'Tools', icon: 'build', class: 'tools-parent', childClass: 'material-child-icon',
    children: ['/materials-dashboard', '/rm1-delivery', '/xe-tai', '/fgs-dashboard', '/label', '/bieu-mau'],
  },
  {
    title: 'Report', icon: 'assessment', class: 'report-parent', childClass: 'material-child-icon',
    children: ['/report', '/shorted-materials'],
  },
  '/location',
  '/nhiet-do',
  '/equipment-checklist',
  '/qc',
  '/qc-traceability',
  '/index',
  '/sxxk',
  '/checklist',
  '/equipment',
  '/settings',
  '/zalo',
  '/j-warehouse',
];

/** Thứ tự nhóm trong popup cấp quyền tab. */
const PERMISSION_GROUP_ORDER: PermissionGroup[] = ['Chính', 'RM', 'FG', 'Khác'];

// ───────────────────────── Helpers ─────────────────────────

const TAB_BY_PATH = new Map(APP_TABS.map(t => [t.path, t]));

function normalizePath(url: string): string {
  return String(url || '').split('?')[0].split('#')[0];
}

export function getAppTab(url: string): AppTab | undefined {
  return TAB_BY_PATH.get(normalizePath(url));
}

/** Key quyền của 1 URL; '/menu' coi như 'dashboard'. null = không có tab hoặc tab không cần quyền. */
export function getTabKeyForUrl(url: string): string | null {
  const path = normalizePath(url);
  if (path === '/menu') return 'dashboard';
  return TAB_BY_PATH.get(path)?.key ?? null;
}

export function isAdminOnlyTabKey(key: string): boolean {
  return APP_TABS.some(t => t.key === key && t.adminOnly);
}

export const DESKTOP_ONLY_TAB_PATHS: string[] = APP_TABS.filter(t => t.desktopOnly).map(t => t.path);

export const OWN_NAV_TAB_PATHS: string[] = ['/menu', ...APP_TABS.filter(t => t.ownNav).map(t => t.path)];

/** Danh sách tab cho popup cấp quyền (Settings), đã xếp theo nhóm. */
export const TAB_PERMISSION_OPTIONS: Array<{ key: string; name: string; category: PermissionGroup }> =
  PERMISSION_GROUP_ORDER.flatMap(group =>
    APP_TABS
      .filter(t => t.key && t.permission?.group === group)
      .map(t => ({ key: t.key as string, name: t.permission!.name, category: group }))
  );
