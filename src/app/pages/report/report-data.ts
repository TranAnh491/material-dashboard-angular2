export interface MaterialAnalysisRow {
  materialCode: string;
  customer: string;
  turnover: number;
  doi: number;
  /** Giá trị tồn trung bình — kích thước bubble (triệu VND, tùy chọn). */
  inventoryValue: number;
}

/** Dữ liệu mẫu Material Analysis (Top 20) — thay bằng API/Firestore khi có nguồn thật. */
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

export const REPORT_TRACKING_PERIOD = '01 Jan 2025 – 30 Apr 2026';
export const REPORT_SCOPE = 'Top 20 Materials';

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
