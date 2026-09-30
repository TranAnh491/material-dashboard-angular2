import { Component } from '@angular/core';
import { Router } from '@angular/router';

export interface StockOutLine {
  stt: number;
  poNumber: string;
  materialCode: string;
  materialName: string;
  unit: string;
  quantity: number;
  actualQuantity: number;
  nxkCode: string;
  locationCode: string;
  remark: string;
}

export type BieuMauFormId = 'stock-out' | 'five-s';

export interface BieuMauFormCard {
  id: BieuMauFormId;
  icon: string;
  title: string;
  subtitle: string;
}

export type FiveSBuilding = 'J4' | 'J5';

/** Một vùng 5S trên mặt bằng J4/J5 — tọa độ mét theo trục mặt A → mặt D. */
export interface FiveSZone {
  name: string;
  color: string;
  building: FiveSBuilding;
  fromM: number;
  toM: number;
  team: string;
  leader: string;
  members: string;
}

export interface FiveSCriterion {
  vi: string;
  jp: string;
  en: string;
  content: string;
}

const FIVE_S_STORAGE_KEY = 'bieu-mau-5s-j4j5';

@Component({
  selector: 'app-bieu-mau',
  templateUrl: './bieu-mau.component.html',
  styleUrls: ['./bieu-mau.component.scss']
})
export class BieuMauComponent {
  /** Danh sách biểu mẫu — mỗi biểu mẫu 1 icon */
  readonly forms: BieuMauFormCard[] = [
    { id: 'stock-out', icon: 'receipt_long', title: 'Phiếu xuất kho', subtitle: 'Stock Out Note' },
    { id: 'five-s', icon: 'cleaning_services', title: '5S Kho J4 – J5', subtitle: '5S Zone Responsibility' }
  ];

  activeForm: BieuMauFormId | null = null;

  /** Kích thước xưởng J4 / J5 (m) — khớp mặt bằng J Warehouse */
  readonly BUILDING_LENGTH_M = 105;
  readonly BUILDING_WIDTH_M = 30;
  /** Tỉ lệ vẽ sơ đồ 5S: px / m */
  readonly MAP_SCALE = 8;
  readonly MAP_PAD = 28;
  readonly MAP_GAP = 6;

  fiveSMeta = {
    managementCode: 'WH-5S/F01',
    version: '01',
    issuedDate: this.todayText()
  };

  fiveSZones: FiveSZone[] = this.defaultFiveSZones();

  readonly fiveSCriteria: FiveSCriterion[] = [
    { vi: 'Sàng lọc', jp: 'Seiri', en: 'Sort', content: 'Loại bỏ vật dụng, pallet, bao bì không cần thiết ra khỏi vùng' },
    { vi: 'Sắp xếp', jp: 'Seiton', en: 'Set in order', content: 'Hàng hóa, pallet, dụng cụ đúng vị trí quy định, có nhãn / biển báo' },
    { vi: 'Sạch sẽ', jp: 'Seiso', en: 'Shine', content: 'Sàn, kệ, lối đi sạch; không rác, không đổ tràn, không mạng nhện' },
    { vi: 'Săn sóc', jp: 'Seiketsu', en: 'Standardize', content: 'Vạch kẻ sàn, biển báo, nhãn kệ rõ ràng, được duy trì theo chuẩn' },
    { vi: 'Sẵn sàng', jp: 'Shitsuke', en: 'Sustain', content: 'Tuân thủ 5S; lối thoát hiểm, bình chữa cháy, tủ điện thông thoáng' }
  ];
  /** Metadata form control */
  formMeta = {
    managementCode: 'WH-P01/F04',
    version: '04',
    issuedDate: '02/05/2022'
  };

  /** Demo header — khớp mẫu hình */
  header = {
    voucherNo: 'KZPX0826/0351',
    outputDate: '05/08/2026',
    warehouse: 'CC',
    productCode: '',
    dispatchType: 'X-CC3',
    receivingDept: '',
    productionOrder: '',
    remark: 'ASM1 Xuất CCDC PD'
  };

  /** Demo lines */
  lines: StockOutLine[] = [
    {
      stt: 2,
      poNumber: 'KZPO0726 /0036',
      materialCode: 'C022046',
      materialName: 'Dây TE tiếp địa Cadivi CV-2.5 (1 ROLL = 100M)',
      unit: 'ROLL',
      quantity: 1,
      actualQuantity: 1,
      nxkCode: 'ND',
      locationCode: '',
      remark: ''
    }
  ];

  constructor(private router: Router) {
    this.loadFiveS();
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  openForm(id: BieuMauFormId): void {
    this.activeForm = id;
  }

  backToList(): void {
    this.activeForm = null;
  }

  get activeFormCard(): BieuMauFormCard | undefined {
    return this.forms.find(f => f.id === this.activeForm);
  }

  // ====== 5S J4 – J5 ======

  private defaultFiveSZones(): FiveSZone[] {
    const half = this.BUILDING_LENGTH_M / 2;
    return [
      { name: 'Vùng 1', color: '#1e88e5', building: 'J4', fromM: 0, toM: half, team: 'Team 1', leader: '', members: '' },
      { name: 'Vùng 2', color: '#43a047', building: 'J4', fromM: half, toM: this.BUILDING_LENGTH_M, team: 'Team 2', leader: '', members: '' },
      { name: 'Vùng 3', color: '#fb8c00', building: 'J5', fromM: 0, toM: half, team: 'Team 3', leader: '', members: '' },
      { name: 'Vùng 4', color: '#8e24aa', building: 'J5', fromM: half, toM: this.BUILDING_LENGTH_M, team: 'Team 4', leader: '', members: '' }
    ];
  }

  private todayText(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  private loadFiveS(): void {
    try {
      const raw = localStorage.getItem(FIVE_S_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved?.meta) this.fiveSMeta = { ...this.fiveSMeta, ...saved.meta };
      if (Array.isArray(saved?.zones) && saved.zones.length === 4) {
        this.fiveSZones = saved.zones.map((z: Partial<FiveSZone>, i: number) => ({
          ...this.fiveSZones[i],
          ...z
        }));
      }
    } catch {
      // bỏ qua — dùng mặc định
    }
  }

  saveFiveS(): void {
    try {
      localStorage.setItem(
        FIVE_S_STORAGE_KEY,
        JSON.stringify({ meta: this.fiveSMeta, zones: this.fiveSZones })
      );
    } catch {
      // storage không khả dụng — chỉ giữ trong phiên
    }
  }

  resetFiveS(): void {
    if (!confirm('Khôi phục phân vùng 5S mặc định?')) return;
    this.fiveSZones = this.defaultFiveSZones();
    this.saveFiveS();
  }

  clampZoneRange(zone: FiveSZone): void {
    const max = this.BUILDING_LENGTH_M;
    zone.fromM = Math.min(Math.max(Number(zone.fromM) || 0, 0), max);
    zone.toM = Math.min(Math.max(Number(zone.toM) || 0, 0), max);
    if (zone.toM < zone.fromM) [zone.fromM, zone.toM] = [zone.toM, zone.fromM];
    this.saveFiveS();
  }

  get mapWidth(): number {
    return this.BUILDING_LENGTH_M * this.MAP_SCALE + this.MAP_PAD * 2;
  }

  get mapHeight(): number {
    return this.BUILDING_WIDTH_M * this.MAP_SCALE * 2 + this.MAP_GAP + this.MAP_PAD * 2;
  }

  get buildingW(): number {
    return this.BUILDING_LENGTH_M * this.MAP_SCALE;
  }

  get buildingH(): number {
    return this.BUILDING_WIDTH_M * this.MAP_SCALE;
  }

  /** J4 phía trên (mặt E), J5 phía dưới (mặt B) — J4 giáp J5 ở mặt C */
  buildingY(b: FiveSBuilding): number {
    return b === 'J4' ? this.MAP_PAD : this.MAP_PAD + this.buildingH + this.MAP_GAP;
  }

  zoneRect(z: FiveSZone): { x: number; y: number; w: number; h: number } {
    return {
      x: this.MAP_PAD + z.fromM * this.MAP_SCALE,
      y: this.buildingY(z.building),
      w: Math.max(0, (z.toM - z.fromM) * this.MAP_SCALE),
      h: this.buildingH
    };
  }

  /** Vạch trục mỗi 10m */
  get axisTicks(): number[] {
    const ticks: number[] = [];
    for (let m = 0; m <= this.BUILDING_LENGTH_M; m += 10) ticks.push(m);
    if (ticks[ticks.length - 1] !== this.BUILDING_LENGTH_M) ticks.push(this.BUILDING_LENGTH_M);
    return ticks;
  }

  zoneScope(z: FiveSZone): string {
    const f = (n: number) => (Number(n) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
    return `Xưởng ${z.building} · ${f(z.fromM)}m → ${f(z.toM)}m (từ mặt A) · ${f((z.toM - z.fromM) * this.BUILDING_WIDTH_M)} m²`;
  }

  getLogoSrc(): string {
    return typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/assets/img/logo.png`
      : '/assets/img/logo.png';
  }

  formatQty(n: number): string {
    return (Number(n) || 0).toLocaleString('vi-VN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  printForm(): void {
    window.print();
  }
}
