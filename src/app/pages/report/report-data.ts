import * as XLSX from 'xlsx';

export interface MaterialAnalysisRow {
  materialCode: string;
  customer: string;
  turnover: number;
  doi: number;
  /** Giá trị tồn (USD) — quy đổi từ VND theo tỷ giá VCB. */
  inventoryValue: number;
}

/** Alias — FG dùng cùng cấu trúc, materialCode = mã TP */
export type FgAnalysisRow = MaterialAnalysisRow;

export type ReportDataType = 'materials' | 'fgs';

/** Snapshot lưu trên Firestore (collection report-data, doc materials | fgs) */
export interface ReportSnapshot {
  type: ReportDataType;
  period: string;
  updatedAt: any; // Firestore Timestamp
  rows: MaterialAnalysisRow[];
  /** Tỷ giá VCB dùng khi import (VND/USD) */
  usdRate?: number;
}

/** Kết quả đọc 1 file import chung cho Materials + FGs */
export interface ReportImportResult {
  materials: MaterialAnalysisRow[];
  fgs: MaterialAnalysisRow[];
  sheetNames: string[];
  usdRate: number;
}

/** Dữ liệu mẫu Material Analysis (Top 20) — dùng khi chưa có dữ liệu Firestore. */
export const SAMPLE_MATERIAL_ANALYSIS: MaterialAnalysisRow[] = [
  { materialCode: 'B005143', customer: 'GIL', turnover: 499.11, doi: 1, inventoryValue: 42 },
  { materialCode: 'B024051', customer: 'AXONE', turnover: 72.4, doi: 1, inventoryValue: 28 },
  { materialCode: 'B024052', customer: 'AXONE', turnover: 68.2, doi: 1, inventoryValue: 26 },
  { materialCode: 'B027565', customer: 'N/A', turnover: 55.0, doi: 4, inventoryValue: 18 },
  { materialCode: 'B017136', customer: 'AUDI', turnover: 85.59, doi: 5, inventoryValue: 31 },
  { materialCode: 'B018679', customer: 'AUDI', turnover: 86.23, doi: 6, inventoryValue: 33 },
  { materialCode: 'B018077', customer: 'NGUYEN CO', turnover: 61.5, doi: 7, inventoryValue: 22 },
  { materialCode: 'B028502', customer: 'N/A', turnover: 61.5, doi: 8, inventoryValue: 20 },
  { materialCode: 'B007523', customer: 'N/A', turnover: 24.3, doi: 12, inventoryValue: 15 },
  { materialCode: 'B025252', customer: 'N/A', turnover: 18.6, doi: 14, inventoryValue: 12 },
  { materialCode: 'B025099', customer: 'N/A', turnover: 15.2, doi: 16, inventoryValue: 11 },
  { materialCode: 'B009464', customer: 'N/A', turnover: 12.8, doi: 18, inventoryValue: 10 },
  { materialCode: 'B017877', customer: 'N/A', turnover: 11.4, doi: 22, inventoryValue: 9 },
  { materialCode: 'B023379', customer: 'N/A', turnover: 8.5, doi: 25, inventoryValue: 14 },
  { materialCode: 'B016365', customer: 'N/A', turnover: 6.2, doi: 32, inventoryValue: 19 },
  { materialCode: 'B018323', customer: 'N/A', turnover: 5.8, doi: 30, inventoryValue: 17 },
  { materialCode: 'B016410', customer: 'N/A', turnover: 5.1, doi: 30, inventoryValue: 16 },
  { materialCode: 'B009599', customer: 'N/A', turnover: 4.2, doi: 45, inventoryValue: 24 },
  { materialCode: 'B001681', customer: 'N/A', turnover: 3.1, doi: 60, inventoryValue: 30 },
  { materialCode: 'B016149', customer: 'N/A', turnover: 2.8, doi: 60, inventoryValue: 28 }
];

export const SAMPLE_FG_ANALYSIS: FgAnalysisRow[] = [
  { materialCode: 'FG001', customer: 'GIL', turnover: 12.5, doi: 8, inventoryValue: 85 },
  { materialCode: 'FG002', customer: 'AUDI', turnover: 9.8, doi: 12, inventoryValue: 72 },
  { materialCode: 'FG003', customer: 'AXONE', turnover: 8.2, doi: 15, inventoryValue: 60 },
  { materialCode: 'FG004', customer: 'N/A', turnover: 6.5, doi: 20, inventoryValue: 45 },
  { materialCode: 'FG005', customer: 'N/A', turnover: 5.1, doi: 28, inventoryValue: 38 }
];

export const REPORT_TRACKING_PERIOD = '01 Jan 2025 – 30 Apr 2026';
export const REPORT_SCOPE = 'Top 20 Materials';
export const MATERIALS_TOP_COUNT = 20;
export const MATERIALS_BCTK_SHEET_HINT = 'BCTK NVL';
/** Tỷ giá tạm tính VND/USD */
export const REPORT_USD_RATE = 26_200;
export const XUAT_SHEET_HINT = 'XUẤT';
export const DMTP_SHEET_HINT = 'DMTP';
/** Cột A (0-based = 0) trên sheet DMTP = Mã TP */
export const DMTP_PRODUCT_COL = 0;
/** Cột H (0-based = 7) trên sheet DMTP = Khách hàng */
export const DMTP_CUSTOMER_COL = 7;

/** DMTP lưu Firestore: report-data/dmtp */
export interface ReportDmtpSnapshot {
  rows: unknown[][];
  updatedAt: any;
}

/** Map mã vật tư → mã sản phẩm từ sheet XUẤT (report-data/xuat-material-product) */
export interface ReportXuatMapSnapshot {
  map: Record<string, string>;
  updatedAt: any;
}

export const TURNOVER_THRESHOLD = 10;
export const DOI_THRESHOLD = 35;

export type MaterialQuadrant = 'excellent' | 'monitor' | 'potential' | 'risk';

export function classifyMaterialQuadrant(turnover: number, doi: number): MaterialQuadrant {
  const highTurnover = turnover >= TURNOVER_THRESHOLD;
  const highDoi = doi >= DOI_THRESHOLD;
  if (highTurnover && !highDoi) return 'excellent';
  if (highTurnover && highDoi) return 'monitor';
  if (!highTurnover && !highDoi) return 'potential';
  return 'risk';
}

export const QUADRANT_COLORS: Record<MaterialQuadrant, string> = {
  excellent: '#22c55e',
  monitor: '#3b82f6',
  potential: '#f59e0b',
  risk: '#ef4444'
};

/** Normalize header tên cột từ Excel → key chuẩn (bỏ dấu tiếng Việt). */
export function normalizeExcelHeader(raw: string): string {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[\s_-]+/g, '');
}

export function parseExcelNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return isNaN(value) ? 0 : value;

  let s = String(value).trim().replace(/\s/g, '');
  if (!s) return 0;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    s = s.replace(',', '.');
  }

  s = s.replace(/[^\d.-]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** Map header chuẩn hoá → field của MaterialAnalysisRow */
export const EXCEL_HEADER_MAP: Record<string, keyof MaterialAnalysisRow> = {
  materialcode: 'materialCode',
  fgcode: 'materialCode',
  code: 'materialCode',
  mã: 'materialCode',
  manhang: 'materialCode',
  customer: 'customer',
  khachhang: 'customer',
  turnover: 'turnover',
  doi: 'doi',
  daysofinventory: 'doi',
  inventoryvalue: 'inventoryValue',
  giatriton: 'inventoryValue',
  value: 'inventoryValue'
};

const MATERIAL_CODE_HEADER_KEYS = [
  'manvl',
  'mahang',
  'mavattu',
  'macode',
  'materialcode',
  'code'
];

/** Layout BCTK NVL / BCTK LinkQ: mã cột A, số dư cuối kỳ cột G, dữ liệu từ dòng 8 Excel */
const BCTK_NVL_FIXED = { startRow: 7, ma: 0, value: 6 } as const;

const MATERIAL_CODE_PATTERN = /^B[A-Z0-9]/i;

function findSheetByHint(workbook: XLSX.WorkBook, hint: string): XLSX.WorkSheet | null {
  const key = normalizeExcelHeader(hint);
  const sheetName = (workbook.SheetNames || []).find((name) => {
    const normalized = normalizeExcelHeader(name);
    return normalized === key || normalized.includes(key);
  });
  return sheetName ? workbook.Sheets[sheetName] : null;
}

function findBctkNvlSheet(workbook: XLSX.WorkBook): XLSX.WorkSheet | null {
  const direct = findSheetByHint(workbook, MATERIALS_BCTK_SHEET_HINT);
  if (direct) return direct;

  const sheetName = (workbook.SheetNames || []).find((name) => {
    const normalized = normalizeExcelHeader(name);
    return normalized.includes('bctk') && normalized.includes('nvl');
  });
  return sheetName ? workbook.Sheets[sheetName] : null;
}

function isMaterialCode(value: unknown): boolean {
  const code = String(value ?? '').trim().toUpperCase();
  return !!code && MATERIAL_CODE_PATTERN.test(code);
}

function buildMergedHeaders(rows: unknown[][], headerRowIndex: number, span = 3): string[] {
  const end = Math.min(rows.length, headerRowIndex + span);
  let maxCols = 0;
  for (let r = headerRowIndex; r < end; r++) {
    maxCols = Math.max(maxCols, rows[r]?.length || 0);
  }

  const headers: string[] = [];
  for (let c = 0; c < maxCols; c++) {
    const parts: string[] = [];
    for (let r = headerRowIndex; r < end; r++) {
      const cell = String(rows[r]?.[c] ?? '').trim();
      if (cell) parts.push(cell);
    }
    headers.push(normalizeExcelHeader(parts.join(' ')));
  }
  return headers;
}

function findHeaderRowIndex(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const merged = buildMergedHeaders(rows, i, 3);
    if (merged.some((h) => h.includes('soducuoiky'))) return i;

    const row = rows[i];
    if (!row?.length) continue;
    const hasClosingBalance = row.some((cell) => {
      const h = normalizeExcelHeader(String(cell ?? ''));
      return h.includes('soducuoiky');
    });
    if (hasClosingBalance) return i;
  }
  return -1;
}

function findColumnIndex(headers: string[], matchers: string[]): number {
  for (const matcher of matchers) {
    const idx = headers.findIndex((h) => {
      if (!h) return false;
      if (matcher.length <= 3) return h === matcher;
      return h === matcher || h.includes(matcher);
    });
    if (idx >= 0) return idx;
  }
  return -1;
}

function findValueColumnIndex(headers: string[]): number {
  const idx = findColumnIndex(headers, [
    'soducuoiky',
    'sodu cuoiky',
    'giatricuoiky',
    'toncuoikyvalue',
    'value'
  ]);
  if (idx >= 0) return idx;

  return headers.findIndex((h) => h.includes('soducuoiky') || h.includes('cuoiky'));
}

function normCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function looksLikeProductCode(code: string): boolean {
  return /^P[A-Z0-9]/i.test(code);
}

/** Các biến thể mã SP để khớp DMTP (P005363, P005363_A, 005363, …). */
function productLookupKeys(code: string): string[] {
  const c = normCode(code);
  if (!c) return [];
  const keys = new Set<string>([c]);
  if (c.includes('_')) keys.add(c.split('_')[0]);
  if (c.includes('-')) keys.add(c.split('-')[0]);
  if (c.startsWith('P') && c.length > 1) keys.add(c.slice(1));
  if (!c.startsWith('P') && /^[0-9]/.test(c)) keys.add('P' + c);
  return [...keys];
}

function findProductCodeInRow(row: unknown[], skipCols: number[] = []): string {
  for (let c = 0; c < row.length; c++) {
    if (skipCols.includes(c)) continue;
    const v = normCode(row[c]);
    if (looksLikeProductCode(v)) return v;
  }
  return '';
}

function isPxRow(row: unknown[], ctuIdx: number): boolean {
  const ctu = normCode(ctuIdx >= 0 ? row[ctuIdx] : row[0]);
  if (!ctu) return false;
  if (ctu === 'PX' || ctu === 'PXK') return true;
  if (ctu.includes('PHIEU') && ctu.includes('XUAT')) return true;
  return ctu.startsWith('PX') && ctu.length <= 6;
}

/** Layout LinkQ / MORE PXK: A=ctừ, D=mã SP, F=mã vật tư, dữ liệu từ dòng 8. */
const XUAT_PXK_FIXED = { startRow: 7, ctu: 0, product: 3, material: 5 } as const;
const XUAT_SXXK_FIXED = { startRow: 6, ctu: 0, material: 8, product: 3 } as const;

function sheetToRows(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
}

function findXuatSheet(workbook: XLSX.WorkBook): XLSX.WorkSheet | null {
  const names = workbook.SheetNames || [];
  const match = (name: string): boolean => {
    const n = normalizeExcelHeader(name);
    return (
      n.includes('xuat')
      || n === 'px'
      || n === 'pxk'
      || n.includes('phieuxuat')
      || n.includes('xnvl')
    );
  };
  const sheetName = names.find(match);
  if (sheetName) return workbook.Sheets[sheetName];

  // Sheet không tên XUẤT nhưng có cột PX + mã B* (workbook gộp LinkQ)
  for (const name of names) {
    const n = normalizeExcelHeader(name);
    if (n.includes('bctk') || n.includes('dmtp') || n.includes('tondau')) continue;
    const rows = sheetToRows(workbook.Sheets[name]);
    if (rows.length > 10 && sheetLooksLikeXuat(rows)) {
      return workbook.Sheets[name];
    }
  }
  return null;
}

function sheetLooksLikeXuat(rows: unknown[][]): boolean {
  let pxHits = 0;
  let materialHits = 0;
  const scanEnd = Math.min(rows.length, 200);
  for (let i = 0; i < scanEnd; i++) {
    const row = rows[i] as unknown[];
    if (!row?.length) continue;
    if (isPxRow(row, 0)) pxHits++;
    const mat = normCode(row[XUAT_PXK_FIXED.material]) || normCode(row[XUAT_SXXK_FIXED.material]);
    if (isMaterialCode(mat)) materialHits++;
  }
  return pxHits >= 3 && materialHits >= 3;
}

function findDmtpSheet(workbook: XLSX.WorkBook): XLSX.WorkSheet | null {
  return findSheetByHint(workbook, DMTP_SHEET_HINT);
}

function findHeaderRowByMarkers(rows: unknown[][], markers: string[]): number {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const merged = buildMergedHeaders(rows, i, 3);
    if (markers.every((m) => merged.some((h) => h.includes(m)))) return i;
  }
  return -1;
}

/**
 * Sheet XUẤT: chứng từ PX → mã vật tư → mã sản phẩm.
 */
function collectPxkMaterialProduct(
  rows: unknown[][],
  startRow: number,
  map: Map<string, string>
): void {
  const { ctu, product, material } = XUAT_PXK_FIXED;
  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row?.length || !isPxRow(row, ctu)) continue;

    const mat = normCode(row[material]);
    if (!isMaterialCode(mat)) continue;

    let prod = normCode(row[product]);
    if (!prod || !looksLikeProductCode(prod)) {
      prod = findProductCodeInRow(row, [ctu, material, XUAT_SXXK_FIXED.material]);
    }
    if (mat && prod) map.set(mat, prod);
  }
}

export function buildMaterialToProductMap(workbook: XLSX.WorkBook): Map<string, string> {
  const sheet = findXuatSheet(workbook);
  const map = new Map<string, string>();
  if (!sheet) return map;

  const rows = sheetToRows(sheet);
  if (!rows.length) return map;

  // LinkQ PXK cố định (ưu tiên)
  collectPxkMaterialProduct(rows, XUAT_PXK_FIXED.startRow, map);
  if (!map.size) collectPxkMaterialProduct(rows, XUAT_SXXK_FIXED.startRow, map);
  if (!map.size) collectPxkMaterialProduct(rows, 1, map);

  // Header-based
  if (!map.size) {
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const merged = buildMergedHeaders(rows, i, 3);
      const hasMaterial = merged.some((h) => h.includes('mavattu') || h.includes('manvl'));
      const hasProduct = merged.some((h) => h.includes('masanpham') || h.includes('masp') || h.includes('matp'));
      if (hasMaterial && hasProduct) {
        headerRowIndex = i;
        break;
      }
    }

    if (headerRowIndex >= 0) {
      const headers = buildMergedHeaders(rows, headerRowIndex, 3);
      const ctuIdx = findColumnIndex(headers, ['machungtu', 'mactu', 'mact', 'loaichungtu', 'mact']);
      const materialIdx = findColumnIndex(headers, ['mavattu', 'manvl', 'mahang']);
      const productIdx = findColumnIndex(headers, ['masanpham', 'masp', 'masptp', 'matep', 'matp']);

      if (materialIdx >= 0) {
        for (let i = headerRowIndex + 1; i < rows.length; i++) {
          const row = rows[i] as unknown[];
          if (!isPxRow(row, ctuIdx)) continue;

          const material = normCode(row[materialIdx]);
          if (!isMaterialCode(material)) continue;

          let product = productIdx >= 0 ? normCode(row[productIdx]) : '';
          if (!product) product = findProductCodeInRow(row, [materialIdx]);
          if (material && product) map.set(material, product);
        }
      }
    }
  }

  // SXXK: A=PX, I=mã vật tư, D hoặc quét P*
  if (!map.size) {
    const { startRow, ctu, material, product } = XUAT_SXXK_FIXED;
    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      if (!row || !isPxRow(row, ctu)) continue;
      const mat = normCode(row[material]);
      if (!isMaterialCode(mat)) continue;
      let prod = normCode(row[product]);
      if (!prod || !looksLikeProductCode(prod)) {
        prod = findProductCodeInRow(row, [ctu, material]);
      }
      if (prod) map.set(mat, prod);
    }
  }

  return map;
}

function findDmtpDataStartRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const hA = normalizeExcelHeader(String(rows[i]?.[DMTP_PRODUCT_COL] ?? ''));
    const hH = normalizeExcelHeader(String(rows[i]?.[DMTP_CUSTOMER_COL] ?? ''));
    if (
      (hA.includes('ma') && (hA.includes('tp') || hA.includes('sp') || hA.includes('hang')))
      || hH.includes('khach')
      || hH.includes('customer')
    ) {
      return i + 1;
    }
  }
  return 0;
}

/** DMTP: cột A = mã TP, cột H = khách hàng (Firebase hoặc Excel). */
export function parseDmtpRowsToCustomerMap(rows: unknown[][]): Map<string, string> {
  const map = new Map<string, string>();
  if (!rows?.length) return map;

  const startRow = findDmtpDataStartRow(rows);

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row?.length) continue;
    const product = normCode(row[DMTP_PRODUCT_COL]);
    const customer = String(row[DMTP_CUSTOMER_COL] ?? '').trim();
    if (!product || !customer) continue;
    if (product === 'STT' || product.includes('MA TP') || product.includes('MÃ TP')) continue;

    for (const key of productLookupKeys(product)) {
      map.set(key, customer);
    }
  }

  return map;
}

/** Parse DMTP từ object Firestore (items / map / nested). */
export function parseDmtpFirestoreData(data: Record<string, unknown> | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!data) return map;

  const rows = (data.rows || data.data || data.sheetData) as unknown[][] | undefined;
  if (rows?.length) {
    parseDmtpRowsToCustomerMap(rows).forEach((v, k) => map.set(k, v));
  }

  const items = data.items as Array<{ maTp?: string; materialCode?: string; customer?: string; khachHang?: string }> | undefined;
  if (items?.length) {
    for (const item of items) {
      const product = normCode(item.maTp || item.materialCode);
      const customer = String(item.customer || item.khachHang || '').trim();
      if (!product || !customer) continue;
      for (const key of productLookupKeys(product)) map.set(key, customer);
    }
  }

  const flatMap = data.map as Record<string, string> | undefined;
  if (flatMap) {
    for (const [product, customer] of Object.entries(flatMap)) {
      const p = normCode(product);
      const c = String(customer ?? '').trim();
      if (p && c) {
        for (const key of productLookupKeys(p)) map.set(key, c);
      }
    }
  }

  const nested = data.DMTP as { rows?: unknown[][] } | unknown[][] | undefined;
  if (nested) {
    const nestedRows = Array.isArray(nested) ? nested : nested.rows;
    if (nestedRows?.length) {
      parseDmtpRowsToCustomerMap(nestedRows).forEach((v, k) => map.set(k, v));
    }
  }

  return map;
}

export function extractDmtpRowsFromWorkbook(workbook: XLSX.WorkBook): unknown[][] | null {
  const sheet = findDmtpSheet(workbook);
  if (!sheet) return null;
  return sheetToRows(sheet);
}

function buildProductToCustomerMap(workbook: XLSX.WorkBook): Map<string, string> {
  const rows = extractDmtpRowsFromWorkbook(workbook);
  return rows ? parseDmtpRowsToCustomerMap(rows) : new Map();
}

export function mergeCustomerMaps(...maps: Map<string, string>[]): Map<string, string> {
  const merged = new Map<string, string>();
  for (const map of maps) {
    map.forEach((customer, product) => merged.set(product, customer));
  }
  return merged;
}

export function recordToMaterialProductMap(record: Record<string, string> | undefined | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!record) return map;
  for (const [material, product] of Object.entries(record)) {
    const m = normCode(material);
    const p = normCode(product);
    if (m && p) map.set(m, p);
  }
  return map;
}

export function materialProductMapToRecord(map: Map<string, string>): Record<string, string> {
  const record: Record<string, string> = {};
  map.forEach((product, material) => {
    record[material] = product;
  });
  return record;
}

function lookupProductCustomer(
  product: string,
  productToCustomer: Map<string, string>
): string {
  for (const key of productLookupKeys(product)) {
    const hit = productToCustomer.get(key);
    if (hit) return hit;
  }

  const base = productLookupKeys(product)[0]?.split('_')[0] || '';
  if (!base) return 'N/A';

  for (const [k, customer] of productToCustomer.entries()) {
    if (k.startsWith(base) || base.startsWith(k.split('_')[0])) {
      return customer;
    }
  }
  return 'N/A';
}

function resolveCustomer(
  materialCode: string,
  materialToProduct: Map<string, string>,
  productToCustomer: Map<string, string>
): string {
  const product = materialToProduct.get(normCode(materialCode));
  if (!product) return 'N/A';
  return lookupProductCustomer(product, productToCustomer);
}

function convertVndToUsd(vnd: number, usdRate: number): number {
  if (!usdRate || usdRate <= 0) return vnd;
  return Math.round((vnd / usdRate) * 100) / 100;
}

/** Dữ liệu cũ có thể lưu VND — tự quy đổi khi giá trị quá lớn so với USD. */
export function normalizeStoredMaterialsUsd(
  rows: MaterialAnalysisRow[],
  usdRate: number = REPORT_USD_RATE
): MaterialAnalysisRow[] {
  if (!rows.length || !usdRate) return rows;
  const max = Math.max(...rows.map((r) => r.inventoryValue), 0);
  if (max <= 500_000) return rows;

  return rows.map((row) => ({
    ...row,
    inventoryValue: convertVndToUsd(row.inventoryValue, usdRate)
  }));
}

export function reapplyMaterialCustomers(
  rows: MaterialAnalysisRow[],
  materialToProduct: Map<string, string>,
  productToCustomer: Map<string, string>
): MaterialAnalysisRow[] {
  return rows.map((row) => ({
    ...row,
    customer: resolveCustomer(row.materialCode, materialToProduct, productToCustomer)
  }));
}

function enrichMaterials(
  materials: MaterialAnalysisRow[],
  workbook: XLSX.WorkBook,
  usdRate: number,
  firebaseDmtp?: Map<string, string>,
  firebaseXuat?: Map<string, string>
): MaterialAnalysisRow[] {
  const materialToProduct = buildMaterialToProductMap(workbook);
  if (firebaseXuat?.size) {
    firebaseXuat.forEach((product, material) => {
      if (!materialToProduct.has(material)) materialToProduct.set(material, product);
    });
  }
  const productToCustomer = mergeCustomerMaps(
    firebaseDmtp || new Map(),
    buildProductToCustomerMap(workbook)
  );

  return reapplyMaterialCustomers(
    materials.map((row) => ({
      ...row,
      inventoryValue: convertVndToUsd(row.inventoryValue, usdRate)
    })),
    materialToProduct,
    productToCustomer
  );
}

function rowsToTopMaterials(valueByCode: Map<string, number>): MaterialAnalysisRow[] {
  return [...valueByCode.entries()]
    .map(([materialCode, inventoryValue]) => ({
      materialCode,
      customer: 'N/A',
      turnover: 0,
      doi: 0,
      inventoryValue
    }))
    .sort((a, b) => b.inventoryValue - a.inventoryValue)
    .slice(0, MATERIALS_TOP_COUNT);
}

function collectMaterialsFromRows(
  rows: unknown[][],
  startRow: number,
  codeIdx: number,
  valueIdx: number
): Map<string, number> {
  const valueByCode = new Map<string, number>();

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row?.length) continue;

    const code = String(row[codeIdx] ?? '').trim().toUpperCase();
    if (!isMaterialCode(code)) continue;

    const inventoryValue = parseExcelNumber(row[valueIdx]);
    if (inventoryValue <= 0) continue;

    valueByCode.set(code, (valueByCode.get(code) || 0) + inventoryValue);
  }

  return valueByCode;
}

function parseMaterialsByHeader(rows: unknown[][]): MaterialAnalysisRow[] {
  const headerRowIndex = findHeaderRowIndex(rows);
  if (headerRowIndex < 0) return [];

  const headers = buildMergedHeaders(rows, headerRowIndex, 3);
  const codeIdx = findColumnIndex(headers, MATERIAL_CODE_HEADER_KEYS);
  const valueIdx = findValueColumnIndex(headers);

  if (codeIdx === -1 || valueIdx === -1) return [];

  const valueByCode = collectMaterialsFromRows(rows, headerRowIndex + 1, codeIdx, valueIdx);
  return rowsToTopMaterials(valueByCode);
}

/** Fallback: cột A = mã, G = số dư cuối kỳ (layout BCTK LinkQ / SXXK). */
function parseMaterialsByFixedColumns(rows: unknown[][]): MaterialAnalysisRow[] {
  const { startRow, ma, value } = BCTK_NVL_FIXED;
  let valueByCode = collectMaterialsFromRows(rows, startRow, ma, value);
  if (valueByCode.size) return rowsToTopMaterials(valueByCode);

  for (const tryStart of [6, 5, 4, 3, 2, 1, 0]) {
    valueByCode = collectMaterialsFromRows(rows, tryStart, ma, value);
    if (valueByCode.size) break;
  }

  return rowsToTopMaterials(valueByCode);
}

/**
 * Materials: sheet BCTK NVL — lọc mã B*, cột Số dư cuối kỳ = giá trị tồn, lấy top 20.
 */
export function parseMaterialsFromBctkNvlSheet(sheet: XLSX.WorkSheet): MaterialAnalysisRow[] {
  const jsonRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!jsonRows.length) return [];

  const byHeader = parseMaterialsByHeader(jsonRows);
  if (byHeader.length) return byHeader;

  return parseMaterialsByFixedColumns(jsonRows);
}

function parseFgsSheetRows(sheet: XLSX.WorkSheet): MaterialAnalysisRow[] {
  const jsonRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!jsonRows.length || !jsonRows[0]?.length) {
    return [];
  }

  const headers: string[] = (jsonRows[0] as unknown[]).map((h) =>
    normalizeExcelHeader(String(h ?? ''))
  );

  const colIndex = (field: keyof MaterialAnalysisRow): number =>
    headers.findIndex((h) => EXCEL_HEADER_MAP[h] === field);

  const codeIdx = colIndex('materialCode');
  const customerIdx = colIndex('customer');
  const turnoverIdx = colIndex('turnover');
  const doiIdx = colIndex('doi');
  const valueIdx = colIndex('inventoryValue');

  if (codeIdx === -1 || turnoverIdx === -1 || doiIdx === -1) {
    return [];
  }

  const parsed: MaterialAnalysisRow[] = [];
  for (let i = 1; i < jsonRows.length; i++) {
    const row = jsonRows[i] as unknown[];
    const code = String(row[codeIdx] ?? '').trim();
    if (!code) continue;

    parsed.push({
      materialCode: code,
      customer: customerIdx >= 0 ? String(row[customerIdx] ?? 'N/A').trim() || 'N/A' : 'N/A',
      turnover: parseExcelNumber(row[turnoverIdx]),
      doi: parseExcelNumber(row[doiIdx]),
      inventoryValue: valueIdx >= 0 ? parseExcelNumber(row[valueIdx]) : 0
    });
  }

  return parsed;
}

/**
 * Đọc 1 file Excel chung cho Materials + FGs.
 * Materials: BCTK NVL (top 20, VND) → USD + Customer (XUẤT → DMTP Firebase/Excel).
 */
export function parseReportWorkbook(
  workbook: XLSX.WorkBook,
  usdRate: number,
  firebaseDmtp?: Map<string, string>,
  firebaseXuat?: Map<string, string>
): ReportImportResult {
  const sheetNames = workbook.SheetNames || [];
  const bctkNvlSheet = findBctkNvlSheet(workbook);
  const fgsSheet = sheetNames[1] ? workbook.Sheets[sheetNames[1]] : null;

  const materialsVnd = bctkNvlSheet ? parseMaterialsFromBctkNvlSheet(bctkNvlSheet) : [];
  const materials = enrichMaterials(materialsVnd, workbook, usdRate, firebaseDmtp, firebaseXuat);

  return {
    sheetNames,
    materials,
    fgs: fgsSheet ? parseFgsSheetRows(fgsSheet) : [],
    usdRate
  };
}
