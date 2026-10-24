/**
 * Matrix rule & quyền của tab Materials — mỗi nhà máy (ASM1 / ASM2) một cấu hình riêng.
 *
 * - RULE_DEFS: các rule đang chạy trong Materials (bật/tắt, ngày, số, danh sách).
 * - ACTION_DEFS: các thao tác cần quyền; bảng Quyền gán theo mã nhân viên.
 * - Giá trị đang dùng lưu ở Firestore `app-settings/materials-matrix-<factory>`,
 *   sửa trong More → Matrix rule & quyền. Ở đây chỉ là mặc định khi chưa lưu.
 */

export type MatrixFactory = 'ASM1' | 'ASM2';
export type MatrixRuleType = 'bool' | 'date' | 'number' | 'text';
export type MatrixRuleValue = boolean | string | number;

export interface MatrixRuleDef {
  key: string;
  group: string;
  label: string;
  hint: string;
  type: MatrixRuleType;
  /** Mặc định theo nhà máy. Ngày dạng yyyy-MM-dd; danh sách cách nhau bởi dấu phẩy. */
  defaults: Record<MatrixFactory, MatrixRuleValue>;
}

export interface MatrixActionDef {
  key: string;
  group: string;
  label: string;
}

export const MATERIALS_MATRIX_PASS = '2026';
export const MATERIALS_MATRIX_DOC_PREFIX = 'app-settings/materials-matrix-';
/** Dòng quyền áp cho mọi nhân viên chưa có dòng riêng. */
export const MATRIX_DEFAULT_ROW = '*';

export const RULE_DEFS: MatrixRuleDef[] = [
  {
    key: 'qrLockEnabled', group: 'In tem', type: 'bool',
    label: 'Khóa cột QR theo IMD',
    hint: 'Bật: không in QR cho dòng có IMD từ ngày bên dưới trở đi.',
    defaults: { ASM1: true, ASM2: false }
  },
  {
    key: 'qrLockImdFrom', group: 'In tem', type: 'date',
    label: 'Khóa QR từ IMD',
    hint: 'Áp dụng khi "Khóa cột QR theo IMD" đang bật.',
    defaults: { ASM1: '2026-10-01', ASM2: '2026-10-01' }
  },
  {
    key: 'temMoiCutoff', group: 'In tem', type: 'date',
    label: 'Mốc tem mẫu mới',
    hint: 'IMD từ ngày này trở đi là tem mẫu mới, không cần in lại.',
    defaults: { ASM1: '2026-04-01', ASM2: '2026-04-01' }
  },
  {
    key: 'reprintFlagRule', group: 'In tem', type: 'bool',
    label: 'Rule "đã in lại tem mẫu mới"',
    hint: 'Bật: dòng IMD trước mốc tem mới phải được in lại mới tính là xong.',
    defaults: { ASM1: true, ASM2: true }
  },
  {
    key: 'locationAlwaysUnlocked', group: 'Vị trí', type: 'bool',
    label: 'Luôn mở sửa Vị trí / WH / Pallet',
    hint: 'Bật: sửa tay không cần OTP. Tắt: phải mở khóa cột Vị trí bằng mã Zalo.',
    defaults: { ASM1: true, ASM2: true }
  },
  {
    key: 'kkAgingImdFrom', group: 'Kiểm kê', type: 'date',
    label: 'Aging tính theo IMD từ',
    hint: 'IMD từ ngày này tính Aging theo IMD; trước đó tính theo PO.',
    defaults: { ASM1: '2026-01-01', ASM2: '2026-01-01' }
  },
  {
    key: 'kkAgingExemptMonths', group: 'Kiểm kê', type: 'number',
    label: 'Không cần kiểm khi Aging dưới (tháng)',
    hint: 'Dòng có Aging nhỏ hơn số tháng này được tự tick "Không cần kiểm".',
    defaults: { ASM1: 1, ASM2: 1 }
  },
  {
    key: 'kkExcludedPrefixes', group: 'Kiểm kê', type: 'text',
    label: 'Đầu mã không kiểm KK',
    hint: 'Mã bắt đầu bằng các đầu này bị ẩn khỏi kiểm kê. Cách nhau bởi dấu phẩy.',
    defaults: { ASM1: 'R,B033', ASM2: 'R,B033' }
  },
  {
    key: 'kkHiddenMucs', group: 'Kiểm kê', type: 'text',
    label: 'Mục KK bị ẩn',
    hint: 'Mục (category) không hiện trên sơ đồ loại hàng. Cách nhau bởi dấu phẩy.',
    defaults: { ASM1: 'B033', ASM2: 'B033' }
  },
  {
    key: 'linkqDiffThreshold', group: 'LinkQ', type: 'number',
    label: 'Ngưỡng lệch LinkQ',
    hint: 'Tô đỏ / tính "Có lệch" khi |chênh lệch| lớn hơn số này.',
    defaults: { ASM1: 1, ASM2: 1 }
  },
  {
    key: 'hiddenRetentionDays', group: 'Tồn kho', type: 'number',
    label: 'Giữ dòng Ẩn (ngày)',
    hint: 'Số ngày giữ dòng trong Danh mục Ẩn trước khi xóa hẳn.',
    defaults: { ASM1: 30, ASM2: 30 }
  },
  {
    key: 'invAdjustPass', group: 'Tồn kho', type: 'text',
    label: 'Mật khẩu Danh mục điều chỉnh',
    hint: 'Mật khẩu mở More → Danh mục điều chỉnh.',
    defaults: { ASM1: '2026', ASM2: '2026' }
  }
];

export const ACTION_DEFS: MatrixActionDef[] = [
  { key: 'edit', group: 'Chung', label: 'Sửa dữ liệu dòng tồn' },
  { key: 'delete', group: 'Chung', label: 'Ẩn / xóa dòng' },
  { key: 'export', group: 'Chung', label: 'Xuất Excel' },
  { key: 'printQr', group: 'In tem', label: 'In QR' },
  { key: 'printLabels', group: 'In tem', label: 'Tem lẻ / Tem thùng / In lại / In tùy chỉnh' },
  { key: 'location', group: 'Vị trí', label: 'Sửa vị trí' },
  { key: 'xt', group: 'Xuất', label: 'XT (xuất tay theo bag)' },
  { key: 'kkTick', group: 'Kiểm kê', label: 'Tick KK' },
  { key: 'invReport', group: 'Báo cáo', label: 'Báo "Đã hết stock"' },
  { key: 'invAdjustRequest', group: 'Báo cáo', label: 'Gửi đề nghị điều chỉnh tồn' },
  { key: 'invAdjustApprove', group: 'Báo cáo', label: 'Duyệt / xóa điều chỉnh' },
  { key: 'moreSensitive', group: 'More', label: 'Import / gộp / snapshot / reset / Danh mục Ẩn' },
  { key: 'manualOn', group: 'More', label: 'Bật Manual (tồn đầu / xuất tay)' },
  { key: 'xtLockToggle', group: 'More', label: 'Khóa / mở khóa XT ASM1' }
];

export interface MatrixDoc {
  rules?: Record<string, MatrixRuleValue>;
  /** perms[empId | '*'][actionKey] = true/false */
  perms?: Record<string, Record<string, boolean>>;
  updatedBy?: string;
}

export function defaultRuleValues(factory: MatrixFactory): Record<string, MatrixRuleValue> {
  const out: Record<string, MatrixRuleValue> = {};
  for (const d of RULE_DEFS) out[d.key] = d.defaults[factory];
  return out;
}

export function defaultPermRow(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const a of ACTION_DEFS) out[a.key] = true;
  return out;
}

/** Ghép giá trị đã lưu với mặc định — key thiếu / sai kiểu thì lấy mặc định. */
export function normalizeRuleValues(factory: MatrixFactory, raw: Record<string, unknown> | undefined): Record<string, MatrixRuleValue> {
  const out = defaultRuleValues(factory);
  for (const d of RULE_DEFS) {
    const v = raw?.[d.key];
    if (d.type === 'bool' && typeof v === 'boolean') out[d.key] = v;
    else if (d.type === 'number' && typeof v === 'number' && isFinite(v)) out[d.key] = v;
    else if (d.type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) out[d.key] = v;
    else if (d.type === 'text' && typeof v === 'string') out[d.key] = v;
  }
  return out;
}

export function normalizePerms(raw: Record<string, unknown> | undefined): Record<string, Record<string, boolean>> {
  const out: Record<string, Record<string, boolean>> = { [MATRIX_DEFAULT_ROW]: defaultPermRow() };
  const entries = Object.entries(raw || {}).sort(([a], [b]) => (a === MATRIX_DEFAULT_ROW ? -1 : b === MATRIX_DEFAULT_ROW ? 1 : 0));
  for (const [emp, row] of entries) {
    const id = emp === MATRIX_DEFAULT_ROW ? emp : emp.trim().toUpperCase();
    if (!id || !row || typeof row !== 'object') continue;
    const base = id === MATRIX_DEFAULT_ROW ? defaultPermRow() : { ...out[MATRIX_DEFAULT_ROW] };
    for (const a of ACTION_DEFS) {
      const v = (row as Record<string, unknown>)[a.key];
      if (typeof v === 'boolean') base[a.key] = v;
    }
    out[id] = base;
  }
  return out;
}

/** yyyy-MM-dd → ms (0h giờ máy). */
export function matrixDateMs(value: MatrixRuleValue | undefined): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : 0;
}

export function matrixList(value: MatrixRuleValue | undefined): string[] {
  return String(value ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}
