import { AgingFactory, AgingRow, InventoryRow, LedgerRow } from '../../services/aging-report.parse';

/**
 * Đối chiếu Báo cáo tuổi hàng TP với bảng kê nhập / xuất (theo Mã TP + Mã lô + Kho).
 *
 * Quy tắc:
 * - Tồn lot theo bảng kê = Σ nhập − Σ xuất (chứng từ có ngày ≤ ngày cuối kỳ của báo cáo).
 * - Phiếu xuất không ghi lô → phân bổ FIFO vào các lot còn tồn của cùng mã + kho (lot nhập trước xuất trước).
 * - Lot có phiếu nhập thành phẩm (TP) / nhập điều chuyển (PN) trong bảng kê → tồn đầu = 0, tồn Aging phải = tồn bảng kê,
 *   ngày nhập Aging phải = ngày phiếu nhập đầu tiên.
 * - Lot không có phiếu nhập trong bảng kê (tồn từ trước kỳ): chỉ kiểm được Aging ≥ phát sinh
 *   (tồn đầu suy ra = Aging − phát sinh, phải ≥ 0).
 * - Số tháng = (ngày cuối kỳ − Inbound Date) / 30, làm tròn 1 số lẻ; nhóm tuổi theo mốc 4 / 8 / 12 / 24 tháng.
 * - Kho ngoài bảng kê (BTP1, TP_NG, TP SAMPLE…) chỉ kiểm số tháng, nhóm tuổi, giá trị.
 */

export type AgingLevel = 'error' | 'ok' | 'info' | 'scope';

export const AGING_BUCKETS = [
  'Under 4 month',
  'From 4 to 8 month',
  'From 8 to 12 month',
  'From 12 to 24 month',
  'Over 24 month',
] as const;

export interface LotCompareRow {
  id: string;
  factory: AgingFactory;
  sku: string;
  name: string;
  cus: string;
  lot: string;
  wh: string;
  inAging: boolean;
  agingInb: string;
  ledgerInb: string;
  agingMonths: number | null;
  calcMonths: number | null;
  agingType: string;
  calcType: string;
  agingQty: number;
  /** Tồn theo bảng kê (null khi kho ngoài bảng kê) */
  ledgerQty: number | null;
  /** Aging − bảng kê */
  diffQty: number | null;
  /** Tồn đầu suy ra cho lot trước kỳ */
  openingQty: number | null;
  inQty: number;
  outQty: number;
  price: number;
  value: number;
  issues: string[];
  /** Số tháng Aging lệch số tháng tính lại (tô ô) */
  monthsWrong: boolean;
  level: AgingLevel;
  statusText: string;
  searchText: string;
}

export interface SkuCompareRow {
  id: string;
  factory: AgingFactory;
  sku: string;
  name: string;
  cus: string;
  /** Tồn BC tồn kho (kho 21), null nếu chưa import */
  invQty: number | null;
  /** Tổng Aging các kho trong bảng kê (TP, DL…) */
  agingQtyScope: number;
  agingQtyAll: number;
  agingValue: number;
  diffQty: number | null;
  lotErrors: number;
  issues: string[];
  level: AgingLevel;
  statusText: string;
  searchText: string;
}

export interface FactoryCompareResult {
  factory: AgingFactory;
  reportTo: string;
  ledgerFrom: string;
  ledgerTo: string;
  inventoryTo: string;
  /** Số mã có phát sinh sau ngày cuối bảng kê (chưa kiểm được tồn lot) */
  gapSkuCount: number;
  scopeWh: string[];
  lots: LotCompareRow[];
  skus: SkuCompareRow[];
  /** Tổng giá trị theo nhóm tuổi (theo file / tính lại) */
  bucketFile: Record<string, number>;
  bucketCalc: Record<string, number>;
  valueByWh: Record<string, number>;
  totalValue: number;
  totalQty: number;
  unallocatedOut: number;
}

const EPS = 0.0001;
const DAY_MS = 86400000;

export const ISSUE = {
  qty: 'Sai tồn',
  inb: 'Sai ngày nhập',
  months: 'Sai số tháng',
  type: 'Sai nhóm tuổi',
  value: 'Sai giá trị',
  noInb: 'Thiếu ngày nhập',
  noReceipt: 'Không có phiếu nhập',
  belowMovement: 'Tồn Aging < phát sinh',
  missingInAging: 'Thiếu trong Aging',
  overExport: 'Xuất vượt nhập',
  invDiff: 'Lệch BC tồn kho',
  lotErr: 'Có lot sai',
  zeroValue: 'Giá trị = 0',
  /** Aging chốt sau ngày cuối bảng kê và mã có phát sinh sau ngày đó → chưa kiểm được tồn */
  afterLedger: 'Phát sinh sau ngày bảng kê',
  /** BC tồn kho khác ngày Aging → chênh lệch chỉ để tham khảo */
  invOtherDay: 'Lệch BC tồn kho khác ngày',
} as const;

/** Vấn đề chỉ để lưu ý (không tính là sai). */
const INFO_ISSUES = new Set<string>([ISSUE.afterLedger, ISSUE.invOtherDay]);
/** Vấn đề về tồn lot — bỏ qua khi mã có phát sinh sau ngày bảng kê. */
const QTY_ISSUES = new Set<string>([ISSUE.qty, ISSUE.missingInAging, ISSUE.overExport, ISSUE.belowMovement, ISSUE.noReceipt]);

function levelOf(issues: string[], fallback: AgingLevel): AgingLevel {
  if (issues.some(i => !INFO_ISSUES.has(i))) return 'error';
  return issues.length ? 'info' : fallback;
}

export interface CompareOptions {
  /** Ngày cuối của bảng kê đã lưu (nhập / xuất, lấy ngày nhỏ hơn) */
  ledgerTo?: string;
  /** Ngày của BC tồn kho dùng để đối chiếu */
  inventoryTo?: string;
}

export function agingBucket(months: number): string {
  if (months < 4) return AGING_BUCKETS[0];
  if (months < 8) return AGING_BUCKETS[1];
  if (months < 12) return AGING_BUCKETS[2];
  if (months < 24) return AGING_BUCKETS[3];
  return AGING_BUCKETS[4];
}

export function agingMonths(inb: string, end: string): number | null {
  if (!inb || !end) return null;
  const days = (Date.parse(end + 'T00:00:00Z') - Date.parse(inb + 'T00:00:00Z')) / DAY_MS;
  return Math.round((days / 30) * 10) / 10;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

interface LotAcc {
  sku: string;
  lot: string;
  wh: string;
  net: number;
  inQty: number;
  outQty: number;
  firstIn: string;
  /** Ngày phiếu nhập TP / PN đầu tiên */
  firstReceipt: string;
}

export function compareFactory(
  factory: AgingFactory,
  ledger: { N: LedgerRow[]; X: LedgerRow[] },
  ledgerFrom: string,
  reportTo: string,
  agingRows: AgingRow[],
  inventoryRows: InventoryRow[] | null,
  opts: CompareOptions = {}
): FactoryCompareResult {
  const end = reportTo;
  type Tx = { r: LedgerRow; sign: 1 | -1 };
  const txs: Tx[] = [];
  for (const r of ledger.N) if (!end || r.d <= end) txs.push({ r, sign: 1 });
  for (const r of ledger.X) if (!end || r.d <= end) txs.push({ r, sign: -1 });
  // Cùng ngày: nhập trước xuất
  txs.sort((a, b) => a.r.d.localeCompare(b.r.d) || b.sign - a.sign);

  const scopeWh = new Set<string>();
  const lots = new Map<string, LotAcc>();
  const bySkuWh = new Map<string, LotAcc[]>();
  const key = (sku: string, lot: string, wh: string) => `${sku}|${lot}|${wh}`;
  const getLot = (sku: string, lot: string, wh: string): LotAcc => {
    const k = key(sku, lot, wh);
    let acc = lots.get(k);
    if (!acc) {
      acc = { sku, lot, wh, net: 0, inQty: 0, outQty: 0, firstIn: '', firstReceipt: '' };
      lots.set(k, acc);
      const g = `${sku}|${wh}`;
      if (!bySkuWh.has(g)) bySkuWh.set(g, []);
      bySkuWh.get(g)!.push(acc);
    }
    return acc;
  };

  let unallocatedOut = 0;
  for (const { r, sign } of txs) {
    if (r.wh) scopeWh.add(r.wh);
    const q = sign * r.q;
    if (q >= 0 || r.lot) {
      const acc = getLot(r.sku, r.lot, r.wh);
      acc.net += q;
      if (q > 0) {
        acc.inQty += q;
        if (!acc.firstIn) acc.firstIn = r.d;
        if (sign > 0 && (r.ct === 'TP' || r.ct === 'PN') && !acc.firstReceipt) acc.firstReceipt = r.d;
      } else acc.outQty -= q;
      continue;
    }
    // Xuất không ghi lô → FIFO
    let need = -q;
    const candidates = (bySkuWh.get(`${r.sku}|${r.wh}`) || [])
      .filter(a => a.net > EPS)
      .sort((a, b) => (a.firstIn || '9999').localeCompare(b.firstIn || '9999'));
    for (const a of candidates) {
      const take = Math.min(need, a.net);
      a.net -= take;
      a.outQty += take;
      need -= take;
      if (need <= EPS) break;
    }
    if (need > EPS) {
      unallocatedOut += need;
      const a = getLot(r.sku, '', r.wh);
      a.net -= need;
      a.outQty += need;
    }
  }

  const bucketFile: Record<string, number> = {};
  const bucketCalc: Record<string, number> = {};
  const valueByWh: Record<string, number> = {};
  let totalValue = 0;
  let totalQty = 0;
  const used = new Set<string>();
  const out: LotCompareRow[] = [];

  for (const a of agingRows) {
    const issues: string[] = [];
    let level: AgingLevel = 'ok';
    const calcMonths = agingMonths(a.inb, end);
    const calcType = calcMonths == null ? '' : agingBucket(calcMonths);
    if (!a.inb) issues.push(ISSUE.noInb);
    if (calcMonths != null && (a.aging == null || Math.abs(a.aging - calcMonths) > 0.15)) issues.push(ISSUE.months);
    if (calcType && a.type !== calcType) issues.push(ISSUE.type);
    if (a.price && Math.abs(a.qty * a.price - a.value) > Math.max(1, Math.abs(a.value) * 0.0005)) issues.push(ISSUE.value);
    if (a.qty > 0 && !(a.value > 0)) issues.push(ISSUE.zeroValue);

    bucketFile[a.type || '(trống)'] = (bucketFile[a.type || '(trống)'] || 0) + a.value;
    bucketCalc[calcType || '(trống)'] = (bucketCalc[calcType || '(trống)'] || 0) + a.value;
    valueByWh[a.wh] = (valueByWh[a.wh] || 0) + a.value;
    totalValue += a.value;
    totalQty += a.qty;

    let ledgerQty: number | null = null;
    let diffQty: number | null = null;
    let openingQty: number | null = null;
    let ledgerInb = '';
    let inQty = 0;
    let outQty = 0;
    const inScope = scopeWh.has(a.wh);
    if (!inScope) {
      level = 'scope';
    } else {
      const k = key(a.sku, a.lot, a.wh);
      used.add(k);
      const acc = lots.get(k);
      const net = acc ? round(acc.net) : 0;
      ledgerQty = net;
      inQty = acc ? acc.inQty : 0;
      outQty = acc ? acc.outQty : 0;
      ledgerInb = acc ? acc.firstReceipt || acc.firstIn : '';
      if (acc && acc.firstReceipt) {
        diffQty = round(a.qty - net);
        if (Math.abs(diffQty) > EPS) issues.push(ISSUE.qty);
        if (a.inb && a.inb !== acc.firstReceipt) issues.push(ISSUE.inb);
      } else if (a.inb && ledgerFrom && a.inb >= ledgerFrom) {
        diffQty = round(a.qty - net);
        issues.push(ISSUE.noReceipt);
        if (Math.abs(diffQty) > EPS) issues.push(ISSUE.qty);
      } else {
        // Lot tồn trước kỳ bảng kê
        openingQty = round(a.qty - net);
        if (openingQty < -EPS) issues.push(ISSUE.belowMovement);
        else if (!issues.length) level = 'info';
      }
    }
    if (issues.length) level = 'error';
    out.push(makeLotRow({
      factory, sku: a.sku, name: a.name, cus: a.cus, lot: a.lot, wh: a.wh, inAging: true,
      agingInb: a.inb, ledgerInb, agingMonths: a.aging, calcMonths, agingType: a.type, calcType,
      agingQty: a.qty, ledgerQty, diffQty, openingQty, inQty, outQty, price: a.price, value: a.value, issues, level,
    }));
  }

  // Lot còn tồn theo bảng kê nhưng không có trong Aging
  const nameBySku = new Map<string, { name: string; cus: string }>();
  agingRows.forEach(a => nameBySku.set(a.sku, { name: a.name, cus: a.cus }));
  inventoryRows?.forEach(r => { if (!nameBySku.has(r.sku)) nameBySku.set(r.sku, { name: r.name, cus: r.cus }); });
  lots.forEach((acc, k) => {
    if (used.has(k)) return;
    const net = round(acc.net);
    if (Math.abs(net) <= EPS) return;
    let issue: string | null = null;
    if (acc.firstReceipt) issue = net > 0 ? ISSUE.missingInAging : ISSUE.overExport;
    else if (net > 0) issue = ISSUE.missingInAging; // tồn đầu ≥ 0 nên tồn thực ≥ net > 0
    if (!issue) return;
    const nm = nameBySku.get(acc.sku);
    out.push(makeLotRow({
      factory, sku: acc.sku, name: nm?.name || '', cus: nm?.cus || '', lot: acc.lot, wh: acc.wh, inAging: false,
      agingInb: '', ledgerInb: acc.firstReceipt || acc.firstIn, agingMonths: null,
      calcMonths: agingMonths(acc.firstReceipt || acc.firstIn, end), agingType: '', calcType: '',
      agingQty: 0, ledgerQty: net, diffQty: round(-net), openingQty: null, inQty: acc.inQty, outQty: acc.outQty,
      price: 0, value: 0, issues: [issue], level: 'error',
    }));
  });
  // Aging chốt sau ngày cuối bảng kê → mã có phiếu sau ngày đó chưa kiểm được tồn lot.
  // Có BC tồn kho cùng thời điểm bảng kê: mã có tổng Aging (kho trong bảng kê) ≠ BC tồn kho là mã có phát sinh sau.
  // Không có: coi mọi mã đang lệch tồn lot là chưa kiểm được.
  const gapSkus = new Set<string>();
  if (opts.ledgerTo && end && opts.ledgerTo < end) {
    if (inventoryRows && opts.inventoryTo && opts.inventoryTo < end) {
      const diff = new Map<string, number>();
      agingRows.forEach(a => { if (scopeWh.has(a.wh)) diff.set(a.sku, (diff.get(a.sku) || 0) + a.qty); });
      inventoryRows.forEach(r => diff.set(r.sku, (diff.get(r.sku) || 0) - r.qty));
      diff.forEach((d, sku) => { if (Math.abs(d) > EPS) gapSkus.add(sku); });
    } else {
      out.forEach(r => { if (r.issues.some(i => QTY_ISSUES.has(i))) gapSkus.add(r.sku); });
    }
    for (let i = 0; i < out.length; i++) {
      const r = out[i];
      if (!gapSkus.has(r.sku) || r.level === 'scope') continue;
      const issues = r.issues.filter(x => !QTY_ISSUES.has(x)).concat(ISSUE.afterLedger);
      const { id, statusText, searchText, monthsWrong, ...rest } = r;
      out[i] = makeLotRow({ ...rest, issues, level: levelOf(issues, r.level) });
    }
  }
  out.sort((x, y) => x.sku.localeCompare(y.sku) || x.lot.localeCompare(y.lot) || x.wh.localeCompare(y.wh));

  return {
    factory, reportTo: end, ledgerFrom, ledgerTo: opts.ledgerTo || '', inventoryTo: opts.inventoryTo || '',
    gapSkuCount: gapSkus.size, scopeWh: Array.from(scopeWh).sort(), lots: out,
    skus: buildSkuRows(factory, out, scopeWh, inventoryRows, !!opts.inventoryTo && opts.inventoryTo !== end, gapSkus),
    bucketFile, bucketCalc, valueByWh, totalValue, totalQty, unallocatedOut,
  };
}

function buildSkuRows(
  factory: AgingFactory, lots: LotCompareRow[], scopeWh: Set<string>, inventoryRows: InventoryRow[] | null,
  inventoryOtherDay: boolean, gapSkus: Set<string>
): SkuCompareRow[] {
  type Acc = { name: string; cus: string; scope: number; all: number; value: number; lotErrors: number; inv: number | null };
  const map = new Map<string, Acc>();
  const get = (sku: string, name: string, cus: string) => {
    let a = map.get(sku);
    if (!a) {
      a = { name, cus, scope: 0, all: 0, value: 0, lotErrors: 0, inv: inventoryRows ? 0 : null };
      map.set(sku, a);
    }
    if (!a.name && name) a.name = name;
    if (!a.cus && cus) a.cus = cus;
    return a;
  };
  for (const l of lots) {
    const a = get(l.sku, l.name, l.cus);
    if (l.inAging) {
      a.all += l.agingQty;
      a.value += l.value;
      if (scopeWh.has(l.wh)) a.scope += l.agingQty;
    }
    if (l.level === 'error') a.lotErrors++;
  }
  inventoryRows?.forEach(r => { const a = get(r.sku, r.name, r.cus); a.inv = (a.inv || 0) + r.qty; });

  const rows: SkuCompareRow[] = [];
  map.forEach((a, sku) => {
    const issues: string[] = [];
    const diffQty = a.inv == null ? null : round(a.scope - a.inv);
    if (diffQty != null && Math.abs(diffQty) > EPS) issues.push(inventoryOtherDay ? ISSUE.invOtherDay : ISSUE.invDiff);
    if (gapSkus.has(sku)) issues.push(ISSUE.afterLedger);
    if (a.lotErrors) issues.push(`${ISSUE.lotErr} (${a.lotErrors})`);
    const level = levelOf(issues, 'ok');
    rows.push({
      id: `${factory}|${sku}`, factory, sku, name: a.name, cus: a.cus, invQty: a.inv, agingQtyScope: round(a.scope),
      agingQtyAll: round(a.all), agingValue: a.value, diffQty, lotErrors: a.lotErrors, issues, level,
      statusText: issues.length ? issues.join(', ') : 'Khớp',
      searchText: `${factory} ${sku} ${a.name} ${a.cus}`.toLowerCase(),
    });
  });
  return rows.sort((x, y) => x.sku.localeCompare(y.sku));
}

let lotRowSeq = 0;

function makeLotRow(r: Omit<LotCompareRow, 'id' | 'statusText' | 'searchText' | 'monthsWrong'>): LotCompareRow {
  const statusText = r.issues.length
    ? r.issues.join(', ')
    : r.level === 'scope' ? 'Kho ngoài bảng kê'
    : r.level === 'info' ? 'Lot trước kỳ' : 'Khớp';
  return {
    ...r,
    id: `${r.factory}|${r.sku}|${r.lot}|${r.wh}|${r.inAging ? 'a' : 'l'}|${++lotRowSeq}`,
    monthsWrong: r.issues.includes(ISSUE.months),
    statusText,
    searchText: `${r.factory} ${r.sku} ${r.lot} ${r.wh} ${r.name} ${r.cus} ${statusText}`.toLowerCase(),
  };
}
