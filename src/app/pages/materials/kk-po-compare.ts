/**
 * So sánh PO (Quản lý Nguyên Liệu → Xem toàn bộ): đối chiếu Mã + PO tồn trên web với file tuổi hàng import.
 * File: Mã vật tư | Tên vật tư | Đvt | Số PO | Hạn sử dụng | Shelf life (month) | Mã kho | Ngày nhập kho | Số tháng | Tồn cuối kỳ | Còn lại
 * Dữ liệu từ dòng 7 (tiêu đề dòng 6). Bỏ dòng kho NVL_KS. Không so IMD.
 */

export const KK_PO_CMP_COLLECTION = 'kk-po-aging-import';
/** Kho không đưa vào so sánh. */
const EXCLUDED_MA_KHO = new Set(['NVL_KS']);
/** Mặc định khi không tìm thấy tiêu đề: A = Mã, D = PO, G = Mã kho, J = Tồn cuối kỳ; dữ liệu từ dòng 7. */
const DEFAULT_COLS = { code: 0, po: 3, maKho: 6, qty: 9 };
const DEFAULT_DATA_START = 6;

export interface KkPoCmpData {
  fileName: string;
  importedAt: Date | null;
  importedBy: string;
  /** Mã → các PO có trong file. */
  byCode: Map<string, Set<string>>;
  /** Số cặp Mã + PO trong file (đã bỏ trùng). */
  pairCount: number;
  /** "MÃ|PO" → Tồn cuối kỳ trong file (file import trước khi có cột lượng thì rỗng). */
  qtyByKey: Map<string, number>;
}

/** 1 dòng bảng so sánh PO của 1 mã. web = null: web không có PO này; inLinkq = false: file không có PO này. */
export interface KkPoCmpDetailRow {
  po: string;
  web: number | null;
  webLines: number;
  inLinkq: boolean;
  /** Tồn cuối kỳ trong file (null nếu file import cũ chưa có cột lượng). */
  linkq: number | null;
}

export function kkPoCmpCode(v: unknown): string {
  return String(v ?? '').trim().toUpperCase();
}

/** PO chuẩn hóa: viết hoa, bỏ khoảng trắng; PO trống → '—' (file tuổi hàng có dòng không PO, web cũng có). */
export const KK_PO_BLANK = '—';

export function kkPoCmpPo(v: unknown): string {
  const po = String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
  // PO00000000 (toàn số 0) = không có PO — cùng nhóm với PO trống của LinkQ
  return !po || /^PO[0\/\-.]*$/.test(po) ? KK_PO_BLANK : po;
}

const fold = (v: unknown) =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();

const toNum = (v: unknown): number => {
  if (typeof v === 'number') return v;
  const n = Number(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};

/** Đọc các dòng sheet (mảng mảng) → cặp "MÃ|PO" + Tồn cuối kỳ (cộng dồn), bỏ kho NVL_KS. */
export function parseKkPoCmpSheet(rows: unknown[][]): { pairs: string[]; qtys: number[]; skippedKs: number } {
  let cols = { ...DEFAULT_COLS };
  let start = DEFAULT_DATA_START;
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = (rows[r] || []).map(fold);
    const code = cells.findIndex((c) => c.startsWith('ma vat t'));
    const po = cells.findIndex((c) => c.startsWith('so po'));
    if (code >= 0 && po >= 0) {
      const kho = cells.findIndex((c) => c.startsWith('ma kho'));
      const qty = cells.findIndex((c) => c.startsWith('ton cuoi'));
      cols = { code, po, maKho: kho >= 0 ? kho : -1, qty: qty >= 0 ? qty : DEFAULT_COLS.qty };
      start = r + 1;
      break;
    }
  }
  const qtyByKey = new Map<string, number>();
  let skippedKs = 0;
  for (let r = start; r < rows.length; r++) {
    const row = rows[r] || [];
    const code = kkPoCmpCode(row[cols.code]);
    const po = kkPoCmpPo(row[cols.po]);
    // PO trống vẫn lấy (thành '—'); bỏ dòng tổng / ghi chú (cột mã không phải mã hàng)
    if (!code || /\s/.test(code) || !/\d/.test(code)) continue;
    if (cols.maKho >= 0 && EXCLUDED_MA_KHO.has(kkPoCmpCode(row[cols.maKho]))) {
      skippedKs++;
      continue;
    }
    const key = `${code}|${po}`;
    qtyByKey.set(key, Math.round(((qtyByKey.get(key) || 0) + toNum(row[cols.qty])) * 10000) / 10000);
  }
  return { pairs: Array.from(qtyByKey.keys()), qtys: Array.from(qtyByKey.values()), skippedKs };
}

/** "MÃ|PO" đã lưu → khóa chuẩn hóa (PO qua kkPoCmpPo). */
function kkPoCmpKey(p: string): string {
  const i = p.indexOf('|');
  return i <= 0 ? '' : `${p.slice(0, i)}|${kkPoCmpPo(p.slice(i + 1))}`;
}

export function buildKkPoCmpQty(pairs: string[], qtys: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(qtys) || qtys.length !== pairs.length) return out;
  // Chuẩn hóa lại PO lúc đọc (file import trước: PO00000000 / trống lưu dạng gốc) — cộng dồn khi trùng
  pairs.forEach((p, i) => {
    const k = kkPoCmpKey(p);
    if (k) out.set(k, (out.get(k) || 0) + toNum(qtys[i]));
  });
  return out;
}

/** Gộp toàn bộ PO của 1 mã ở 2 nguồn: web (tồn theo PO, số dòng) và LinkQ (file). PO lệch lên đầu. */
export function buildKkPoCmpDetail(
  code: string,
  webLines: Array<{ po: unknown; stock: number }>,
  data: KkPoCmpData
): KkPoCmpDetailRow[] {
  const map = new Map<string, KkPoCmpDetailRow>();
  for (const l of webLines) {
    const po = kkPoCmpPo(l.po) || '—';
    const r = map.get(po) || { po, web: 0, webLines: 0, inLinkq: false, linkq: null };
    r.web = Math.round(((r.web || 0) + l.stock) * 10000) / 10000;
    r.webLines += 1;
    map.set(po, r);
  }
  for (const po of data.byCode.get(code) || []) {
    const r = map.get(po) || { po, web: null, webLines: 0, inLinkq: false, linkq: null };
    r.inLinkq = true;
    r.linkq = data.qtyByKey.get(`${code}|${po}`) ?? null;
    map.set(po, r);
  }
  const bad = (r: KkPoCmpDetailRow) => (r.web == null || !r.inLinkq ? 0 : 1);
  return Array.from(map.values()).sort((a, b) => bad(a) - bad(b) || a.po.localeCompare(b.po));
}

export function buildKkPoCmpIndex(pairs: string[]): Map<string, Set<string>> {
  const byCode = new Map<string, Set<string>>();
  for (const p of pairs) {
    const i = p.indexOf('|');
    if (i <= 0) continue;
    const code = p.slice(0, i);
    const set = byCode.get(code) || new Set<string>();
    set.add(kkPoCmpPo(p.slice(i + 1)));
    byCode.set(code, set);
  }
  return byCode;
}
