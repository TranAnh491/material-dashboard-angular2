/**
 * Week trên tem (nhập ở Inbound, chỉ trên web) và hạn dùng theo khách.
 *
 * Dạng:
 * - YYWW: năm + tuần (VD 2642 = tuần 42 năm 2026)
 * - MMYY: tháng + năm (VD 1026 = tháng 10 năm 2026)
 *
 * Hạn dùng so với thời gian trên tem:
 * - YYWW, khách Gilbarco (GIL): dùng sớm tối đa 8 tuần, trễ tối đa 12 tuần
 * - YYWW, khách khác:          dùng sớm tối đa 2 tuần, trễ tối đa 8 tuần
 * - MMYY, mọi khách:            sớm / trễ tối đa 1 tháng
 */
export type WeekFormat = 'YYWW' | 'MMYY';

/** Mã theo dõi Week: chỉ các mã tick cột Week ở Danh mục NVL (+Week / tự tick khi nhập Week). */
export function isWeekTrackedCode(materialCode: string | null | undefined, catalogTracked?: Set<string> | null): boolean {
  const c = String(materialCode || '').trim().toUpperCase();
  return !!c && !!catalogTracked?.has(c);
}

export function isGilbarcoCustomer(customer: string | null | undefined): boolean {
  return /^GIL/i.test(String(customer || '').trim());
}

/** Thứ Hai của tuần ISO `week` năm `year`. */
function isoWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(year, 0, 4);
  const day = jan4.getDay() || 7;
  const monday = new Date(year, 0, 4 - day + 1);
  monday.setDate(monday.getDate() + (week - 1) * 7);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/** Số tuần ISO của năm (52 hoặc 53). */
export function isoWeeksInYear(year: number): number {
  const dec28 = new Date(year, 11, 28);
  const d = new Date(Date.UTC(dec28.getFullYear(), dec28.getMonth(), dec28.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export interface WeekCode {
  format: WeekFormat;
  /** 4 số như trên tem: YYWW hoặc MMYY. */
  value: string;
  year: number;
  /** Tuần (YYWW) hoặc tháng (MMYY). */
  part: number;
  /** Ngày bắt đầu của tuần / tháng trên tem. */
  start: Date;
  /** Ngày cuối của tuần / tháng trên tem. */
  end: Date;
}

/** Kiểm tra + đọc Week. Trả null nếu không hợp lệ. */
export function parseWeekCode(format: string | null | undefined, value: string | null | undefined): WeekCode | null {
  const f = String(format || '').toUpperCase() as WeekFormat;
  const v = String(value || '').replace(/\D/g, '');
  if (v.length !== 4 || (f !== 'YYWW' && f !== 'MMYY')) return null;
  if (f === 'YYWW') {
    const year = 2000 + Number(v.slice(0, 2));
    const week = Number(v.slice(2, 4));
    if (week < 1 || week > isoWeeksInYear(year)) return null;
    const start = isoWeekMonday(year, week);
    const end = new Date(start); end.setDate(end.getDate() + 6); end.setHours(23, 59, 59, 999);
    return { format: f, value: v, year, part: week, start, end };
  }
  const month = Number(v.slice(0, 2));
  const year = 2000 + Number(v.slice(2, 4));
  if (month < 1 || month > 12) return null;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { format: f, value: v, year, part: month, start, end };
}

/** Nhãn ngắn hiển thị: "W42/2026" hoặc "10/2026". */
export function weekCodeLabel(format: string | null | undefined, value: string | null | undefined): string {
  const w = parseWeekCode(format, value);
  if (!w) return '';
  return w.format === 'YYWW' ? `W${String(w.part).padStart(2, '0')}/${w.year}` : `${String(w.part).padStart(2, '0')}/${w.year}`;
}

/** Diễn giải đầy đủ: "Tuần 42 năm 2026" / "Tháng 10 năm 2026". */
export function weekCodeText(format: string | null | undefined, value: string | null | undefined): string {
  const w = parseWeekCode(format, value);
  if (!w) return '';
  return w.format === 'YYWW' ? `Tuần ${w.part} năm ${w.year}` : `Tháng ${w.part} năm ${w.year}`;
}

export interface WeekWindow {
  code: WeekCode;
  /** Quy tắc đang áp: VD "Gilbarco: sớm 8W / trễ 12W". */
  rule: string;
  from: Date;
  to: Date;
  status: 'early' | 'ok' | 'late';
  /** Ngày còn lại tới hạn cuối (âm = đã quá). */
  daysLeft: number;
}

// ───── Rule Week (chỉnh ở Quản lý nguyên liệu → Thao tác → Rule Week; lưu Firestore `week-rules/config`) ─────

export interface WeekCustomerRule {
  /** Khách bắt đầu bằng (không phân biệt hoa thường), VD "GIL" */
  prefix: string;
  /** Tên hiển thị, VD "Gilbarco" */
  name: string;
  /** Được dùng sớm tối đa (tuần) */
  early: number;
  /** Được dùng trễ tối đa (tuần) */
  late: number;
}

export interface WeekRules {
  customers: WeekCustomerRule[];
  /** YYWW — khách khác */
  defaultEarly: number;
  defaultLate: number;
  /** MMYY — mọi khách (tháng) */
  mmyyEarly: number;
  mmyyLate: number;
}

export const DEFAULT_WEEK_RULES: WeekRules = {
  customers: [{ prefix: 'GIL', name: 'Gilbarco', early: 8, late: 12 }],
  defaultEarly: 2,
  defaultLate: 8,
  mmyyEarly: 1,
  mmyyLate: 1,
};

let WEEK_RULES: WeekRules = DEFAULT_WEEK_RULES;
/** Tăng mỗi lần đổi rule — dùng làm khóa cache hiển thị */
export let WEEK_RULES_REV = 0;

export function getWeekRules(): WeekRules {
  return WEEK_RULES;
}

export function setWeekRules(r: Partial<WeekRules> | null | undefined): void {
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  WEEK_RULES = {
    customers: Array.isArray(r?.customers)
      ? r!.customers!.map((c) => ({
        prefix: String(c?.prefix || '').trim().toUpperCase(),
        name: String(c?.name || c?.prefix || '').trim(),
        early: num(c?.early, 0),
        late: num(c?.late, 0),
      })).filter((c) => c.prefix)
      : DEFAULT_WEEK_RULES.customers,
    defaultEarly: num(r?.defaultEarly, DEFAULT_WEEK_RULES.defaultEarly),
    defaultLate: num(r?.defaultLate, DEFAULT_WEEK_RULES.defaultLate),
    mmyyEarly: num(r?.mmyyEarly, DEFAULT_WEEK_RULES.mmyyEarly),
    mmyyLate: num(r?.mmyyLate, DEFAULT_WEEK_RULES.mmyyLate),
  };
  WEEK_RULES_REV++;
}

/** Rule YYWW của khách: khớp đầu tên khách (prefix dài nhất trước), không khớp → khách khác. */
export function weekRuleForCustomer(customer: string | null | undefined): { name: string; early: number; late: number } {
  const c = String(customer || '').trim().toUpperCase();
  const hit = [...WEEK_RULES.customers].sort((a, b) => b.prefix.length - a.prefix.length).find((r) => c.startsWith(r.prefix));
  if (hit) return { name: hit.name || hit.prefix, early: hit.early, late: hit.late };
  return { name: 'Khách khác', early: WEEK_RULES.defaultEarly, late: WEEK_RULES.defaultLate };
}

function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

/** Khoảng được dùng của tem theo khách + trạng thái tại `now`. */
export function weekWindow(
  format: string | null | undefined,
  value: string | null | undefined,
  customer: string | null | undefined,
  now: Date = new Date()
): WeekWindow | null {
  const code = parseWeekCode(format, value);
  if (!code) return null;
  let from: Date;
  let to: Date;
  let rule: string;
  if (code.format === 'YYWW') {
    const r = weekRuleForCustomer(customer);
    from = addDays(code.start, -r.early * 7);
    to = addDays(code.end, r.late * 7);
    rule = `${r.name}: sớm ${r.early}W / trễ ${r.late}W`;
  } else {
    const e = Math.max(0, Math.round(WEEK_RULES.mmyyEarly));
    const l = Math.max(0, Math.round(WEEK_RULES.mmyyLate));
    from = new Date(code.year, code.part - 1 - e, 1);
    to = new Date(code.year, code.part + l, 0, 23, 59, 59, 999);
    rule = `MMYY: sớm ${e}M / trễ ${l}M`;
  }
  const t = now.getTime();
  const status: WeekWindow['status'] = t < from.getTime() ? 'early' : t > to.getTime() ? 'late' : 'ok';
  const daysLeft = Math.floor((to.getTime() - t) / 86400000);
  return { code, rule, from, to, status, daysLeft };
}

export function fmtDmy(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function weekStatusText(w: WeekWindow): string {
  if (w.status === 'early') return `Chưa được dùng (từ ${fmtDmy(w.from)})`;
  if (w.status === 'late') return `Quá hạn ${-w.daysLeft} ngày (hạn ${fmtDmy(w.to)})`;
  return `Còn ${w.daysLeft} ngày (tới ${fmtDmy(w.to)})`;
}
