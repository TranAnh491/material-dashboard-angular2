import { MaterialPlan, MaterialPlanRow } from './material-plan.service';

/**
 * Phân tích Kế hoạch NVL (thuần tính toán, không gọi Firestore):
 *  - quy ra bag theo Standard Packing của Danh mục NVL (mỗi mốc ngày = 1 lần về/xuất → làm tròn lên từng mốc)
 *  - so tồn thực tế (inventory-materials, từng lô) với phần nhu cầu file dự tính lấy từ tồn → rủi ro thiếu hàng.
 */

/** Một cột kỳ (1 mốc ngày, hoặc gộp cả tháng). */
export interface PlanPeriod {
  key: string;
  label: string;
  /** Chỉ số các mốc ngày (buckets) thuộc kỳ này. */
  idx: number[];
}

export type PlanRisk = 'high' | 'mid' | '';

/**
 * Mã cần follow: mã bắt đầu bằng B, trừ Tem / nhãn (label, phôi tem) và Dây rút / Dây buộc (cable tie).
 * Mã không phải B (R…, A…, T…) và nhóm trừ ra coi là không quan trọng.
 */
const LOW_PRIORITY_DES = /(^|[^\p{L}])(tem|nhãn|label)($|[^\p{L}])|dây\s*(rút|buộc)|cable\s*tie/iu;

export function isKeyMaterial(row: MaterialPlanRow): boolean {
  return row.code.startsWith('B') && !LOW_PRIORITY_DES.test(row.des);
}

export interface PlanViewRow {
  row: MaterialPlanRow;
  /** Mã cần follow (xem isKeyMaterial). */
  key: boolean;
  /** Standard Packing (số lượng / bag); 0 = chưa có trong Danh mục NVL. */
  sp: number;
  inQ: number[];
  outQ: number[];
  /** Bag theo kỳ (null khi chưa có Standard Packing). */
  inB: number[] | null;
  outB: number[] | null;
  /** Tồn dự kiến cuối mỗi kỳ (theo tồn trong file) = Tồn − Nợ cũ + Σ về − Σ xuất. */
  bal: number[];
  inTotal: number;
  outTotal: number;
  inBagTotal: number;
  outBagTotal: number;
  minBal: number;
  /** Tồn thực tế hiện tại (null = chưa tải được tồn kho). */
  live: number | null;
  liveBags: number;
  /** Phần nhu cầu file dự tính lấy từ tồn (không mua) = min(Tồn file, Tổng xuất). */
  useFromStock: number;
  /** Tồn thực tế − phần cần dùng từ tồn (âm = thiếu). */
  gap: number | null;
  /** Tồn dùng để so (tồn thực tế nếu đã tải, ngược lại tồn trong file). */
  stockBase: number;
  /** Phần cần dùng từ tồn / stockBase × 100 (0 khi không có tồn). */
  usePct: number;
  /** Kỳ đầu tiên có xuất (Nợ cũ → kỳ đầu). */
  firstNeed: string;
  risk: PlanRisk;
  reasons: string[];
}

export interface PlanPeriodSummary {
  inCodes: number;
  outCodes: number;
  negCodes: number;
  inBags: number;
  outBags: number;
}

export interface PlanKpi {
  inCodes: number;
  outCodes: number;
  inBags: number;
  outBags: number;
  stockUseCodes: number;
  liveBags: number;
  high: number;
  mid: number;
  noSp: number;
}

const EPS = 0.0005;
const bags = (qty: number, sp: number): number => (qty > EPS && sp > 0 ? Math.ceil(qty / sp - 1e-9) : 0);

export function buildPeriods(buckets: string[], group: 'day' | 'month'): PlanPeriod[] {
  const periods: PlanPeriod[] = [];
  buckets.forEach((b, i) => {
    const [y, m, d] = b.split('-');
    if (group === 'day') {
      periods.push({ key: b, label: `${d}/${m}/${y.slice(2)}`, idx: [i] });
    } else {
      const key = `${y}-${m}`;
      const last = periods[periods.length - 1];
      if (last?.key === key) last.idx.push(i);
      else periods.push({ key, label: `T${Number(m)}/${y}`, idx: [i] });
    }
  });
  return periods;
}

/**
 * @param spByCode  Standard Packing theo mã (Danh mục NVL)
 * @param liveLots  Tồn từng lô còn > 0 theo mã (đã lọc nhà máy); null = chưa tải
 */
export function buildRows(
  plan: MaterialPlan,
  periods: PlanPeriod[],
  spByCode: Map<string, number>,
  liveLots: Map<string, number[]> | null
): PlanViewRow[] {
  return plan.rows.map((row) => {
    const sp = spByCode.get(row.code) || 0;
    const sumIdx = (arr: number[], p: PlanPeriod) => p.idx.reduce((a, i) => a + (arr[i] || 0), 0);
    const inQ = periods.map((p) => sumIdx(row.inQty, p));
    const outQ = periods.map((p) => sumIdx(row.outQty, p));
    // Bag: làm tròn lên từng mốc ngày rồi cộng theo kỳ (đổi Theo ngày / Theo tháng không lệch tổng)
    const inB = sp > 0 ? periods.map((p) => p.idx.reduce((a, i) => a + bags(row.inQty[i] || 0, sp), 0)) : null;
    const outB = sp > 0
      ? periods.map((p, k) => p.idx.reduce((a, i) => a + bags(row.outQty[i] || 0, sp), 0) + (k === 0 ? bags(row.shortage, sp) : 0))
      : null;

    // Nợ cũ xuất cùng kỳ đầu (hàng về kỳ đầu đã gồm phần bù nợ cũ)
    let b = row.stock - row.shortage;
    const bal = periods.map((_, k) => (b += inQ[k] - outQ[k]));
    const inTotal = inQ.reduce((a, v) => a + v, 0);
    const outTotal = outQ.reduce((a, v) => a + v, 0) + row.shortage;
    const minBal = bal.length ? Math.min(...bal) : row.stock - row.shortage;

    const lots = liveLots ? liveLots.get(row.code) || [] : null;
    const live = lots ? lots.reduce((a, v) => a + v, 0) : null;
    const liveBags = lots && sp > 0 ? lots.reduce((a, v) => a + bags(v, sp), 0) : 0;
    const useFromStock = Math.max(0, Math.min(row.stock, outTotal));
    const gap = live === null ? null : live - useFromStock;
    const stockBase = live === null ? row.stock : live;
    const usePct = stockBase > EPS ? (useFromStock / stockBase) * 100 : 0;

    const firstIdx = row.shortage > EPS ? 0 : outQ.findIndex((v) => v > EPS);
    const firstNeed = firstIdx >= 0 && periods[firstIdx] ? periods[firstIdx].label : '';

    const reasons: string[] = [];
    let risk: PlanRisk = '';
    if (gap !== null && useFromStock > EPS) {
      if (gap < -EPS) {
        risk = 'high';
        reasons.push('Tồn thực tế thấp hơn phần cần dùng từ tồn');
      } else if (live! < useFromStock * 1.1) {
        risk = 'mid';
        reasons.push('Tồn thực tế sát phần cần dùng (dư < 10%)');
      }
    }
    if (minBal < -EPS) {
      risk = 'high';
      reasons.push('Hàng về sau ngày cần xuất — tồn âm cuối kỳ');
    }

    return {
      row, key: isKeyMaterial(row), sp, inQ, outQ, inB, outB, bal, inTotal, outTotal,
      inBagTotal: inB ? inB.reduce((a, v) => a + v, 0) : 0,
      outBagTotal: outB ? outB.reduce((a, v) => a + v, 0) : 0,
      minBal, live, liveBags, useFromStock, gap, stockBase, usePct, firstNeed, risk, reasons
    };
  });
}

export function summarize(rows: PlanViewRow[], periods: PlanPeriod[]): { periods: PlanPeriodSummary[]; kpi: PlanKpi } {
  const per: PlanPeriodSummary[] = periods.map(() => ({ inCodes: 0, outCodes: 0, negCodes: 0, inBags: 0, outBags: 0 }));
  const kpi: PlanKpi = { inCodes: 0, outCodes: 0, inBags: 0, outBags: 0, stockUseCodes: 0, liveBags: 0, high: 0, mid: 0, noSp: 0 };
  for (const v of rows) {
    periods.forEach((_, k) => {
      const s = per[k];
      if (v.inQ[k] > EPS) s.inCodes++;
      if (v.outQ[k] > EPS || (k === 0 && v.row.shortage > EPS)) s.outCodes++;
      if (v.bal[k] < -EPS) s.negCodes++;
      if (v.inB) s.inBags += v.inB[k];
      if (v.outB) s.outBags += v.outB[k];
    });
    if (v.inTotal > EPS) kpi.inCodes++;
    if (v.outTotal > EPS) kpi.outCodes++;
    kpi.inBags += v.inBagTotal;
    kpi.outBags += v.outBagTotal;
    if (v.useFromStock > EPS) {
      kpi.stockUseCodes++;
      kpi.liveBags += v.liveBags;
    }
    if (v.risk === 'high') kpi.high++;
    else if (v.risk === 'mid') kpi.mid++;
    if (!v.sp && (v.inTotal > EPS || v.outTotal > EPS)) kpi.noSp++;
  }
  return { periods: per, kpi };
}
