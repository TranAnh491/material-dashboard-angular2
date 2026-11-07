import * as XLSX from 'xlsx';

/** Kiểu dữ liệu + đọc file Excel cho Aging Report (thuần, không phụ thuộc Angular — SXXK dùng lại được). */

export type AgingFactory = 'KZ' | 'LH';
export type LedgerKind = 'N' | 'X';
export type AgingFileKind = LedgerKind | 'aging' | 'ton';
/** tp = Aging thành phẩm (theo lô) · nvl = Aging nguyên liệu (theo PO — cột lô mang số PO) */
export type AgingMode = 'tp' | 'nvl';

export const AGING_FACTORIES: AgingFactory[] = ['KZ', 'LH'];
export const AGING_FACTORY_LABEL: Record<AgingFactory, string> = { KZ: 'ASM1 (KZ)', LH: 'ASM2 (LH)' };
export const AGING_FILE_KIND_LABEL: Record<AgingFileKind, string> = {
  N: 'Bảng kê nhập TP',
  X: 'Bảng kê xuất TP',
  aging: 'Báo cáo tuổi hàng',
  ton: 'Báo cáo tồn kho',
};
export const AGING_FILE_KIND_LABEL_NVL: Record<AgingFileKind, string> = {
  N: 'Bảng kê nhập NVL',
  X: 'Bảng kê xuất NVL',
  aging: 'Báo cáo tuổi hàng NVL',
  ton: 'Báo cáo tồn kho',
};

/** Số PO: viết hoa, bỏ khoảng trắng — dùng làm khóa so sánh của Aging NVL. */
export function normPo(v: unknown): string {
  return String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

/** Một dòng bảng kê nhập / xuất. q luôn dương theo file (xuất cũng dương), dấu do kind quyết định. */
export interface LedgerRow {
  /** Ngày chứng từ yyyy-mm-dd */
  d: string;
  /** Mã chứng từ: TP, PN, DC, XP, PX… */
  ct: string;
  /** Số chứng từ */
  no: string;
  sku: string;
  lot: string;
  wh: string;
  q: number;
  lsx: string;
  po: string;
  /** Loại nhập xuất kho */
  loai: string;
  /** Mã đối tượng */
  dt: string;
  /** Diễn giải */
  dg: string;
  /** Mã HQ */
  hq: string;
  /** Mã loại XNK */
  xnk: string;
  price: number;
  amount: number;
}

export interface AgingRow {
  sku: string;
  name: string;
  unit: string;
  lot: string;
  wh: string;
  /** Inbound Date yyyy-mm-dd ('' nếu trống) */
  inb: string;
  /** Aging (tháng) theo file */
  aging: number | null;
  qty: number;
  price: number;
  value: number;
  /** Type of Aging theo file */
  type: string;
  cus: string;
}

export interface InventoryRow {
  sku: string;
  name: string;
  cus: string;
  qty: number;
  value: number;
}

export interface ParsedAgingFile {
  fileName: string;
  kind: AgingFileKind;
  factory: AgingFactory | null;
  /** Từ ngày (yyyy-mm-dd) — có với bảng kê / aging */
  from: string;
  /** Đến ngày / ngày báo cáo (yyyy-mm-dd) */
  to: string;
  ledgerRows?: LedgerRow[];
  agingRows?: AgingRow[];
  inventoryRows?: InventoryRow[];
}

export interface StoredReportInfo {
  id: string;
  from: string;
  to: string;
  fileName: string;
  rowCount: number;
  partCount: number;
  importedAt: string;
  importedBy: string;
}

/**
 * Một chỉnh sửa trên báo cáo tuổi hàng (lưu riêng, file gốc giữ nguyên).
 * key: 'r:<SKU>|<lô>|<kho>|<lần xuất hiện>' cho dòng có trong Aging, 'n:<SKU>|<lô>|<kho>' cho lot thêm mới.
 */
export interface AgingCorrection {
  key: string;
  /** edit = sửa dòng, add = thêm lot thiếu trong Aging, ignore = bỏ qua lỗi (không sửa) */
  action: 'edit' | 'add' | 'ignore';
  lot?: string;
  inb?: string;
  qty?: number;
  price?: number;
  /** Chỉ dùng cho action = add */
  sku?: string;
  name?: string;
  unit?: string;
  wh?: string;
  cus?: string;
  note: string;
  by: string;
  at: string;
}

export interface ImportLogEntry {
  kind: AgingFileKind;
  fileName: string;
  from: string;
  to: string;
  rowCount: number;
  at: string;
  by: string;
}

export interface AgingFactoryMeta {
  factory: AgingFactory;
  /** Kỳ bảng kê đã lưu theo loại (min from / max to) */
  ledgerRange: Partial<Record<LedgerKind, { from: string; to: string }>>;
  reports: StoredReportInfo[];
  inventories: StoredReportInfo[];
  imports: ImportLogEntry[];
}

export interface FactoryLedger {
  N: LedgerRow[];
  X: LedgerRow[];
  /** id doc → (kind, month) để thay thế khi import lại */
  docs: { id: string; kind: LedgerKind; month: string }[];
}

// ───────────────────────── Parse helpers ─────────────────────────

const norm = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

function num(v: unknown): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v ?? '').replace(/,/g, '').trim();
  if (!s || s === '-') return 0;
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

const pad2 = (n: number) => (n < 10 ? '0' : '') + n;

/** Ngày Excel (serial / Date / dd/mm/yyyy) → yyyy-mm-dd */
export function toIsoDate(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    const p = XLSX.SSF.parse_date_code(v);
    return p ? `${p.y}-${pad2(p.m)}-${pad2(p.d)}` : '';
  }
  if (v instanceof Date) return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return `${y}-${pad2(+m[2])}-${pad2(+m[1])}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/** Mã lô: số 5 chữ số (mất số 0 đầu khi Excel đọc thành số) → thêm 0 cho đủ 6 (MMDDYY). */
export function normLot(v: unknown): string {
  let s = String(v ?? '').trim().toUpperCase();
  if (/^\d{5}$/.test(s)) s = '0' + s;
  return s;
}

function findHeaderRow(aoa: unknown[][], required: string[], maxScan = 30): number {
  const req = required.map(norm);
  for (let i = 0; i < Math.min(aoa.length, maxScan); i++) {
    const cells = (aoa[i] || []).map(norm);
    if (req.every(r => cells.includes(r))) return i;
  }
  return -1;
}

function headerIndex(header: unknown[]): (name: string) => number {
  const cells = header.map(norm);
  return (name: string) => cells.indexOf(norm(name));
}

/** Đọc "Từ ngày A đến ngày B" hoặc "Ngày B" ở các dòng tiêu đề. */
function readPeriod(aoa: unknown[][], upTo: number): { from: string; to: string } {
  for (let i = 0; i < Math.min(upTo, aoa.length); i++) {
    const text = (aoa[i] || []).map(c => String(c ?? '')).join(' ');
    const range = text.match(/từ ngày\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*đến ngày\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (range) return { from: toIsoDate(range[1]), to: toIsoDate(range[2]) };
    const single = text.match(/^\s*ngày\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (single) return { from: '', to: toIsoDate(single[1]) };
  }
  return { from: '', to: '' };
}

function titleText(aoa: unknown[][], upTo: number): string {
  return aoa.slice(0, upTo).map(r => (r || []).map(c => String(c ?? '')).join(' ')).join(' | ').toLowerCase();
}

function factoryFromFileName(fileName: string): AgingFactory | null {
  const s = fileName.toUpperCase();
  const lh = /(^|[^A-Z])LH|LH([^A-Z]|$)/.test(s);
  const kz = /(^|[^A-Z])KZ|KZ([^A-Z]|$)/.test(s);
  if (lh && !kz) return 'LH';
  if (kz && !lh) return 'KZ';
  return null;
}

function factoryFromDocNumbers(nos: string[]): AgingFactory | null {
  let kz = 0;
  let lh = 0;
  for (const no of nos) {
    if (no.startsWith('KZ')) kz++;
    else if (no.startsWith('LH')) lh++;
  }
  if (!kz && !lh) return null;
  return kz >= lh ? 'KZ' : 'LH';
}

function sheetAoa(wb: XLSX.WorkBook, name: string): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: '' });
}

/** Nhận diện và đọc 1 file: bảng kê nhập / xuất, báo cáo tuổi hàng, báo cáo tồn kho. */
export function parseAgingWorkbook(wb: XLSX.WorkBook, fileName: string, mode: AgingMode = 'tp'): ParsedAgingFile | null {
  const nvl = mode === 'nvl';
  // 1) Báo cáo tuổi hàng: sheet có header SKU + Mã lô (NVL: PO) + Inbound Date
  for (const name of wb.SheetNames) {
    const aoa = sheetAoa(wb, name);
    let h = findHeaderRow(aoa, ['SKU', 'Mã lô', 'Inbound Date']);
    if (nvl) {
      for (const poName of ['PO', 'Số PO', 'PO No', 'PO number']) {
        if (h >= 0) break;
        h = findHeaderRow(aoa, ['SKU', poName, 'Inbound Date']);
      }
    }
    if (h < 0) continue;
    const ix = headerIndex(aoa[h]);
    // NVL: so theo PO — ưu tiên cột PO, không có thì dùng cột Mã lô
    const poCol = nvl ? ['PO', 'Số PO', 'PO No', 'PO number'].map(n => ix(n)).find(i => i >= 0) ?? -1 : -1;
    const c = {
      sku: ix('SKU'), name: ix('Name'), unit: ix('Unit'), lot: poCol >= 0 ? poCol : ix('Mã lô'), wh: ix('WH'), inb: ix('Inbound Date'),
      aging: ix('Aging'), qty: ix('ERP inventory'), price: ix('Unit Price'), value: ix('Value'), type: ix('Type of Aging'),
      cus: ix('Cus') >= 0 ? ix('Cus') : ix('Customer'),
    };
    const rows: AgingRow[] = [];
    for (const r of aoa.slice(h + 1)) {
      const sku = String(r[c.sku] ?? '').trim();
      if (!sku) continue;
      const agingRaw = r[c.aging];
      rows.push({
        sku,
        name: String(r[c.name] ?? '').trim(),
        unit: String(r[c.unit] ?? '').trim(),
        lot: nvl ? normPo(r[c.lot]) : normLot(r[c.lot]),
        wh: String(r[c.wh] ?? '').trim(),
        inb: toIsoDate(r[c.inb]),
        aging: agingRaw === '' || agingRaw == null ? null : num(agingRaw),
        qty: num(r[c.qty]),
        price: c.price >= 0 ? num(r[c.price]) : 0,
        value: c.value >= 0 ? num(r[c.value]) : 0,
        type: c.type >= 0 ? String(r[c.type] ?? '').trim() : '',
        cus: c.cus >= 0 ? String(r[c.cus] ?? '').trim() : '',
      });
    }
    const period = readPeriod(aoa, h);
    const title = titleText(aoa, h);
    const factory = factoryFromFileName(fileName) || (/tuổi hàng thành phẩm lh/.test(title) ? 'LH' : null);
    return { fileName, kind: 'aging', factory, from: period.from, to: period.to, agingRows: rows };
  }

  const first = wb.SheetNames[0];
  const aoa = sheetAoa(wb, first);
  const title = titleText(aoa, 8);

  // 2) Bảng kê phiếu nhập / xuất
  if (title.includes('bảng kê phiếu nhập') || title.includes('bảng kê phiếu xuất')) {
    const kind: LedgerKind = title.includes('bảng kê phiếu nhập') ? 'N' : 'X';
    const h = findHeaderRow(aoa, ['Mã Ctừ', 'Ngày Ct', 'Mã vật tư', 'Số lượng']);
    if (h < 0) return null;
    const ix = headerIndex(aoa[h]);
    const c = {
      ct: ix('Mã Ctừ'), d: ix('Ngày Ct'), no: ix('Số Ctừ'), dg: ix('Diễn giải'), sku: ix('Mã vật tư'), lot: ix('Mã lô'),
      wh: ix('Mã kho'), q: ix('Số lượng'), lsx: ix('Số lệnh sản xuất'), po: ix('Số PO'), loai: ix('Loại nhập xuất kho'),
      dt: ix('Mã đối tượng'), hq: ix('Mã HQ'), xnk: ix('Mã loại XNK'), price: ix('Giá'), amount: ix('Tiền'),
    };
    const str = (r: unknown[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');
    const rows: LedgerRow[] = [];
    for (const r of aoa.slice(h + 1)) {
      const sku = str(r, c.sku);
      const d = toIsoDate(r[c.d]);
      if (!sku || !d) continue;
      rows.push({
        // NVL: khóa so sánh = Số PO (lưu vào trường lot để dùng chung logic đối chiếu)
        d, ct: str(r, c.ct).toUpperCase(), no: str(r, c.no), sku,
        lot: nvl ? normPo(str(r, c.po)) : normLot(r[c.lot]), wh: str(r, c.wh).toUpperCase(),
        q: num(r[c.q]), lsx: str(r, c.lsx), po: str(r, c.po), loai: str(r, c.loai).toUpperCase(), dt: str(r, c.dt),
        dg: str(r, c.dg).slice(0, 120), hq: str(r, c.hq), xnk: str(r, c.xnk),
        price: c.price >= 0 ? num(r[c.price]) : 0, amount: c.amount >= 0 ? num(r[c.amount]) : 0,
      });
    }
    const period = readPeriod(aoa, h);
    const dates = rows.map(r => r.d).sort();
    const factory = factoryFromFileName(fileName) || factoryFromDocNumbers(rows.map(r => r.no));
    return {
      fileName, kind, factory,
      from: period.from || dates[0] || '',
      to: period.to || dates[dates.length - 1] || '',
      ledgerRows: rows,
    };
  }

  // 3) Báo cáo tồn kho
  if (title.includes('báo cáo tồn kho')) {
    const h = findHeaderRow(aoa, ['Mã vật tư', 'Tồn cuối kỳ']);
    if (h < 0) return null;
    const ix = headerIndex(aoa[h]);
    const c = { sku: ix('Mã vật tư'), name: ix('Tên vật tư'), unit: ix('Đvt'), qty: ix('Tồn cuối kỳ'), value: ix('Số dư cuối kỳ'), cus: ix('Khách hàng') };
    const rows: InventoryRow[] = [];
    for (const r of aoa.slice(h + 1)) {
      const sku = String(r[c.sku] ?? '').trim();
      // Dòng nhóm (TP, TP011…) không có Đvt → bỏ
      if (!sku || !String(r[c.unit] ?? '').trim()) continue;
      const qty = num(r[c.qty]);
      if (!qty) continue;
      rows.push({ sku, name: String(r[c.name] ?? '').trim(), cus: String(r[c.cus] ?? '').trim(), qty, value: num(r[c.value]) });
    }
    const period = readPeriod(aoa, h);
    return { fileName, kind: 'ton', factory: factoryFromFileName(fileName), from: '', to: period.to, inventoryRows: rows };
  }

  return null;
}

