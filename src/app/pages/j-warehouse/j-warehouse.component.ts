import { Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { AngularFirestore } from '@angular/fire/compat/firestore';

export interface JwBlock {
  /** VD: R11 */
  code: string;
  rackNum: number;
  index: number;
  xM: number;
  yM: number;
  wM: number;
  hM: number;
}

export interface JwRack {
  id: string;
  num: number;
  pairIndex: number;
  isInner: boolean;
  xM: number;
  yM: number;
  wM: number;
  hM: number;
  blocks: JwBlock[];
}

export type JwPos = 'A' | 'B' | 'C';

/** Chế độ bản vẽ hiển thị trên mặt bằng */
export type JwDrawMode = 'ky-thuat' | 'hai-quan' | 'camera' | 'kho' | 'dang-ky';
export type JwMapTool = 'overview' | 'pan' | 'select' | 'measure' | 'note' | 'layers';

export type JwLayoutDragKind = 'move' | 'resize';

/** Hướng bố trí kệ J5: ngang (cặp theo trục X) hoặc dọc (cặp theo trục Y, kệ chạy dọc theo chiều dài). */
export type JwRackLayout = 'horizontal' | 'vertical';

export interface JwAisleRect {
  xM: number;
  yM: number;
  wM: number;
  hM: number;
  label: string;
}

export interface JwPairGapRect {
  xM: number;
  yM: number;
  wM: number;
  hM: number;
}

export interface JwDrawModeOption {
  id: JwDrawMode;
  label: string;
}

/** Xem 1 xưởng (J5) hay cả 2 xưởng (J4 + J5) */
export type JwBuildingView = 'j5' | 'j4-j5';

export interface JwBuildingViewOption {
  id: JwBuildingView;
  label: string;
}

export interface JwAxisMark {
  /** VD: Y01 / X21 */
  id: string;
  index: number;
  /** Vị trí mét trên cạnh dài A↔D (trục Y) */
  xM?: number;
  /** Vị trí mét trên cạnh ngắn B↔C (trục X cạnh A) */
  yM?: number;
  /** Khoảng tới trục kế (m), null nếu là trục cuối */
  spanAfterM: number | null;
}

export interface JwPlanFeature {
  id: string;
  kind: 'roller' | 'door' | 'wc' | 'entrance' | 'zone';
  edge: 'A' | 'B' | 'D';
  xM: number;
  yM: number;
  wM: number;
  hM: number;
  label: string;
  subLabel?: string;
  /** Nhãn trục khi vẽ trên J4 (X16–X21). */
  j4SubLabel?: string;
}

export interface JwOfficeRoom {
  id: string;
  label: string;
  labelKey?: string;
  xM: number;
  yM: number;
  wM: number;
  hM: number;
}

/** 1 block (3 tầng ngang) trong 1 dãy kệ Kho mát — VD "A01-1". */
export interface JwKhoMatBlock {
  code: string;
  xM: number;
  yM: number;
  wM: number;
  hM: number;
}

/** 1 dãy kệ Kho mát — VD "A01", gồm 3 block xếp theo chiều sâu phòng. */
export interface JwKhoMatRow {
  id: string;
  xM: number;
  yM: number;
  wM: number;
  hM: number;
  blocks: JwKhoMatBlock[];
}

export interface JwFloorZone {
  id: string;
  label: string;
  labelLines: string[];
  xM: number;
  yM: number;
  wM: number;
  hM: number;
}

export interface JwWcZone {
  id: string;
  label: string;
  labelLines: string[];
  xM: number;
  yM: number;
  wM: number;
  hM: number;
  /** Cửa thoát hiểm 1.5m phía trục X21 — chỉ WC Nữ J5 */
  exit?: { xM: number; yM: number; wM: number; hM: number };
}

/** Mũi tên kích thước khu vực trên bản vẽ kỹ thuật */
export interface JwTechDim {
  id: string;
  isJ4: boolean;
  x1M: number;
  y1M: number;
  x2M: number;
  y2M: number;
  label: string;
  txM: number;
  tyM: number;
  rotate: boolean;
  /** sky = kệ/lối (CAD xanh da trời), green = phòng (CAD xanh lá). */
  tone?: 'sky' | 'green';
  /** Khe/lối quá hẹp để vẽ đường kích thước 2 đầu mũi tên — thay bằng 1 mũi tên dẫn từ nhãn tới khe. */
  leader?: boolean;
}

export type JwLang = 'vi' | 'en';

export interface JwLangOption {
  id: JwLang;
  label: string;
}

const JW_I18N: Record<JwLang, Record<string, string>> = {
  vi: {
    'drawMode.kyThuat': 'Bản vẽ kỹ thuật',
    'drawMode.haiQuan': 'Bản vẽ hải quan',
    'drawMode.camera': 'Sơ đồ Camera',
    'drawMode.kho': 'Sơ đồ Kho',
    'drawMode.dangKy': 'Bản vẽ Đăng ký',
    'header.crumb': 'Sơ đồ kho / Bản vẽ',
    'kpi.racks': 'Dãy kệ',
    'kpi.totalPallets': 'Tổng pallet',
    'kpi.assigned': 'Đã gán',
    'btn.download': 'Tải về',
    'btn.downloading': 'Đang xuất…',
    'btn.work': 'Work',
    'btn.back': 'Quay lại',
    'tool.overview': 'Tổng quan',
    'tool.pan': 'Pan',
    'tool.select': 'Chọn',
    'tool.measure': 'Thước đo',
    'tool.note': 'Ghi chú',
    'tool.layers': 'Lớp',
    'tool.print': 'In',
    'zoom.fit': 'Vừa khung',
    'zoom.fullscreen': 'Toàn màn hình',
    'work.title': 'Work',
    'work.hint': 'Bấm block trên sơ đồ (VD R11) → chọn tầng → vị trí A/B/C → gán pallet.',
    'work.enableHint': 'Bật Work để gán pallet vào vị trí kệ.',
    'endHead.j4': 'J4',
    'endHead.j5': 'J5',
    'faceD.cabinet': 'Tủ điện',
    'faceD.emergency': 'Cửa thoát hiểm',
    'faceD.factory3': 'Factory 3',
    'zone.incomingInspect': 'Khu vực kiểm tra đầu vào',
    'zone.receiving': 'Khu vực Nhận nguyên liệu',
    'zone.wc': 'WC',
    'zone.wcMale': 'WC Nam',
    'zone.wcFemale': 'WC Nữ',
    'zone.forkliftCharging': 'Khu vực sạc xe nâng',
    'zone.j4NonConforming': 'Khu vực hàng không phù hợp',
    'zone.j4ColdStorage': 'Kho Mát',
    'zone.khoMatExt': 'Kho mát mở rộng',
    'zone.vpKho': 'VP Kho',
    'zone.shipping': 'Khu xuất hàng',
    'raised.label': 'NỀN CAO',
    'raised.meta': '{{from}}–{{to}} · {{w}}m · bậc thang lên',
    'raised.fgOutbound': 'FGs Outbound Zone',
    'faceB.fgInbound': 'FGs inbound',
    'door.roller': 'Cửa cuốn',
    'door.gate': 'Cửa',
    'door.faceD': 'Mặt D',
    'aisle.office': 'Lối đi {{m}}m',
    'aisle.rackPair': 'Lối đi 2 kệ {{m}}m',
    'j4.title': 'XƯỞNG J4',
    'info.title': 'Thông tin kho',
    'info.rackRows': 'Dãy kệ',
    'info.rackHeight': 'Cao độ kệ',
    'info.rackSize': 'Kích thước kệ',
    'info.rackSizeLine': 'Dài {{l}}m, ngang {{w}}m: {{n}} kệ',
    'info.longBlockVal': '× {{n}} kệ · {{p}} pallet/kệ',
    'info.aisleForklift': 'Lối đi xe nâng',
    'info.rackGap': 'Khoảng cách giữa 2 kệ',
    'info.officeAisle': 'Lối kệ–VP',
    'info.marginA': 'Cách mặt A',
    'info.marginAVal': '{{m}}m (R11)',
    'info.marginC': 'Cách mặt C',
    'info.office': 'Khu văn phòng',
    'info.raised': 'Nền cao',
    'info.cabinet': 'Tủ điện',
    'info.levels': 'Tầng',
    'info.palletsOnRack': 'Pallet trên kệ',
    'info.atLocation': 'Pallet ở vị trí',
    'info.receiveNvl': 'Nhận NVL',
    'info.exportTp': 'Xuất TP',
    'info.totalJ5': 'Tổng pallet J5',
    'info.updated': 'Cập nhật',
    'alert.exportError': 'Lỗi khi xuất ảnh bản vẽ.'
  },
  en: {
    'drawMode.kyThuat': 'Technical Drawing',
    'drawMode.haiQuan': 'Customs Drawing',
    'drawMode.camera': 'Camera Layout',
    'drawMode.kho': 'Warehouse Layout',
    'drawMode.dangKy': 'Registration Drawing',
    'header.crumb': 'Warehouse layout / Drawing',
    'kpi.racks': 'Rack rows',
    'kpi.totalPallets': 'Total pallets',
    'kpi.assigned': 'Assigned',
    'btn.download': 'Download',
    'btn.downloading': 'Exporting…',
    'btn.work': 'Work',
    'btn.back': 'Back',
    'tool.overview': 'Overview',
    'tool.pan': 'Pan',
    'tool.select': 'Select',
    'tool.measure': 'Measure',
    'tool.note': 'Notes',
    'tool.layers': 'Layers',
    'tool.print': 'Print',
    'zoom.fit': 'Fit view',
    'zoom.fullscreen': 'Fullscreen',
    'work.title': 'Work',
    'work.hint': 'Click a block (e.g. R11) → level → slot A/B/C → assign pallet.',
    'work.enableHint': 'Enable Work to assign pallets to rack slots.',
    'endHead.j4': 'J4',
    'endHead.j5': 'J5',
    'faceD.cabinet': 'Electrical cabinet',
    'faceD.emergency': 'Emergency exit',
    'faceD.factory3': 'Factory 3',
    'zone.incomingInspect': 'Incoming inspection area',
    'zone.receiving': 'Raw material receiving area',
    'zone.wc': 'WC',
    'zone.wcMale': 'WC',
    'zone.wcFemale': 'WC',
    'zone.forkliftCharging': 'Forklift charging area',
    'zone.j4NonConforming': 'Non-conforming goods area',
    'zone.j4ColdStorage': 'Secured WH',
    'zone.khoMatExt': 'Secured WH Extension',
    'zone.vpKho': 'Office',
    'zone.shipping': 'Shipping area',
    'raised.label': 'RAISED FLOOR',
    'raised.meta': '{{from}}–{{to}} · {{w}}m · stairs up',
    'raised.fgOutbound': 'FGs Outbound Zone',
    'faceB.fgInbound': 'FGs inbound',
    'door.roller': 'Roller door',
    'door.gate': 'Door',
    'door.faceD': 'Face D',
    'aisle.office': 'Aisle {{m}}m',
    'aisle.rackPair': 'Aisle between racks {{m}}m',
    'j4.title': 'BUILDING J4',
    'info.title': 'Warehouse info',
    'info.rackRows': 'Rack rows',
    'info.rackHeight': 'Rack height',
    'info.rackSize': 'Rack size',
    'info.rackSizeLine': 'L {{l}}m, W {{w}}m: {{n}} racks',
    'info.longBlockVal': '× {{n}} bays · {{p}} pallets/bay',
    'info.aisleForklift': 'Forklift aisle',
    'info.rackGap': 'Gap between 2 racks',
    'info.officeAisle': 'Rack–office aisle',
    'info.marginA': 'From face A',
    'info.marginAVal': '{{m}}m (R11)',
    'info.marginC': 'From face C',
    'info.office': 'Office area',
    'info.raised': 'Raised floor',
    'info.cabinet': 'Electrical cabinet',
    'info.levels': 'Levels',
    'info.palletsOnRack': 'Pallets on racks',
    'info.atLocation': 'Pallets at location',
    'info.receiveNvl': 'RM received',
    'info.exportTp': 'FG shipped',
    'info.totalJ5': 'Total pallets J5',
    'info.updated': 'Updated',
    'alert.exportError': 'Failed to export drawing image.'
  }
};

/**
 * J Warehouse — mặt bằng 105m × 30m.
 * Mã vị trí: R{dãy}{block}-{tầng}{ABC}  (VD: R11-1A).
 */
@Component({
  selector: 'app-j-warehouse',
  templateUrl: './j-warehouse.component.html',
  styleUrls: ['./j-warehouse.component.scss']
})
export class JWarehouseComponent implements OnInit {
  readonly LENGTH_M = 105;
  readonly WIDTH_M = 30;

  /** Xếp ngang: dãy kệ sát mặt C cách 0.5m */
  readonly MARGIN_C_M = 0.5;
  /** Xếp dọc: dãy kệ sát mặt C cách 0.5m */
  readonly MARGIN_C_VERTICAL_M = 0.5;
  /** Dãy kệ (từ R11) cách mặt A 11.7m — để R296 sát Y15, không đè. */
  readonly RACK_START_M = 11.7;
  /**
   * Dãy kệ: sâu 1m; mâm lọt lòng 3.3m (block 1 & 4 = 2.2m); thanh đứng 0.1m.
   * Cách tường cạnh C: 0.5m. Dài kệ = 4×3.3 + 2×2.2 + 7×0.1 = 18.30m (+ lối 1.5m giữa nhóm block).
   */
  readonly RACK_DEPTH_M = 1;
  /** Cao độ kệ kho */
  readonly RACK_HEIGHT_M = 5;
  readonly BLOCK_LEN_M = 3.3;
  /** Block số 1 & 4 (R×1, R×4): ngắn còn 2.2m */
  readonly BLOCK_SHORT_INDICES: readonly number[] = [1, 4];
  readonly BLOCK_SHORT_LEN_M = 2.2;
  /** @deprecated dùng BLOCK_SHORT_LEN_M */
  readonly BLOCK_1_LEN_M = this.BLOCK_SHORT_LEN_M;
  readonly UPRIGHT_M = 0.1;
  readonly RACK_GAP_M = 0.3;
  /** Xếp dọc: khoảng trống giữa 2 kệ trong 1 cặp (để R{n} và R{n+1} cách 1.5m). */
  readonly RACK_GAP_VERTICAL_M = 0.5;
  readonly BLOCKS_PER_RACK = 6;
  /** Lối đi 1.5m giữa nhóm block 4–5–6 (phía C) và nhóm block 1–2–3 (phía B) */
  readonly BLOCK_GROUP_GAP_M = 1.5;
  readonly PALLETS_PER_BLOCK = 3;
  readonly LEVELS = 4;
  /** Kệ 3.3m: 3 pallet/tầng × 4 tầng = 12 */
  readonly PALLETS_LONG_BLOCK = 12;
  /** Kệ 2.2m: 2 pallet/tầng × 4 tầng = 8 */
  readonly PALLETS_SHORT_BLOCK = 8;
  readonly AISLE_M = 2.9;
  readonly POS_LETTERS: JwPos[] = ['A', 'B', 'C'];
  readonly LEVEL_LIST = [1, 2, 3, 4];

  /** Số thanh đứng = số mâm + 1 */
  readonly UPRIGHT_COUNT = this.BLOCKS_PER_RACK + 1;
  readonly RACK_LEN_BASE_M = this.round2(
    (this.BLOCKS_PER_RACK - this.BLOCK_SHORT_INDICES.length) * this.BLOCK_LEN_M +
      this.BLOCK_SHORT_INDICES.length * this.BLOCK_SHORT_LEN_M +
      this.UPRIGHT_COUNT * this.UPRIGHT_M
  );
  /** Dài dãy kệ ngang — thêm lối 1.5m giữa block 4|5|6 và 1|2|3 */
  readonly RACK_LEN_M = this.round2(
    this.RACK_LEN_BASE_M + this.BLOCK_GROUP_GAP_M - this.UPRIGHT_M
  );

  /**
   * Xếp dọc: yêu cầu toàn bộ block đều 3.3m (không còn block 2.2m),
   * nên chiều dài thân kệ tăng tương ứng.
   */
  readonly RACK_LEN_VERTICAL_M = this.round2(
    this.BLOCKS_PER_RACK * this.BLOCK_LEN_M +
      this.UPRIGHT_COUNT * this.UPRIGHT_M
  );
  readonly PALLET_M = this.round2(this.BLOCK_LEN_M / this.PALLETS_PER_BLOCK);
  /** Cặp R1|R2: 1m + 0.3m khe + 1m */
  readonly PAIR_DEPTH_M = this.RACK_DEPTH_M * 2 + this.RACK_GAP_M;
  readonly PAIR_PITCH_M = this.PAIR_DEPTH_M + this.AISLE_M;

  /** Toàn bộ mặt bằng kho (không crop) — còn chỗ văn phòng / khu khác */
  readonly VIEW_X0_M = 0;
  readonly VIEW_Y0_M = 0;
  readonly VIEW_LENGTH_M = this.LENGTH_M;
  readonly VIEW_WIDTH_M = this.WIDTH_M;

  /** Y bắt đầu vùng trống phía B (sau hết dãy kệ) */
  readonly OPEN_ZONE_Y_M = this.round2(this.MARGIN_C_M + this.RACK_LEN_M);
  readonly OPEN_ZONE_H_M = this.round2(Math.max(0, this.WIDTH_M - this.OPEN_ZONE_Y_M));

  /** px / mét */
  private readonly SCALE = 16;
  private readonly SLOT_PALLET_COLLECTION = 'j-warehouse-slot-pallets';
  private readonly INVENTORY_COLLECTION = 'inventory-materials';
  private readonly LOCATION_HISTORY_COLLECTION = 'material-location-history';
  private readonly SYNC_FACTORIES = ['ASM1', 'ASM2'] as const;
  private readonly LAYOUT_STORAGE_KEY = 'j-warehouse-layout-v14';
  private readonly EXTRA_PALLET_STORAGE_KEY = 'j-warehouse-extra-pallets-v1';
  private readonly LANG_STORAGE_KEY = 'j-warehouse-lang-v1';
  private readonly LAYOUT_SNAP_M = 0.05;
  private readonly BLOCK_MIN_W_M = 0.5;
  private readonly BLOCK_MIN_H_M = 1;

  readonly svgWidth = this.VIEW_LENGTH_M * this.SCALE;
  readonly svgHeight = this.VIEW_WIDTH_M * this.SCALE;

  /** Chừa chỗ trục X cạnh A + nhãn 6.25m + cửa cuốn ngoài */
  readonly padL = 136;
  readonly padR = 110;
  readonly padT = 36;
  /** Chừa chỗ cửa cuốn ngoài cạnh B + chấm Y */
  readonly padB = 118;

  readonly gridX = Array.from(
    { length: Math.floor(this.VIEW_LENGTH_M / 5) - 1 },
    (_, i) => (i + 1) * 5
  );
  readonly gridY = Array.from(
    { length: Math.floor(this.VIEW_WIDTH_M / 5) - 1 },
    (_, i) => (i + 1) * 5
  );

  /** Trục cấu trúc cạnh B: đầu/cuối 7.5m, giữa các nhịp 6m → Y01…Y18 */
  readonly axisMarks: JwAxisMark[] = this.buildAxisMarks();
  /** Trục cạnh A: 6.25+6.25+5+6.25+6.25 = 30m → X21…X26 (C→B) */
  readonly axisXMarks: JwAxisMark[] = this.buildAxisXMarks();

  /** Nền cao từ trục Y15 → Y18 (+0.900) */
  readonly RAISED_FROM_AXIS = 'Y15';
  readonly RAISED_TO_AXIS = 'Y18';
  readonly RAISED_LEVEL = '+0.900';
  readonly raisedZone = this.buildRaisedZone();
  readonly stairSteps = this.buildStairSteps();
  readonly edgeFeatures: JwPlanFeature[] = this.buildEdgeFeatures();

  /**
   * Khu sát B — neo từ Y12, phải → trái:
   * VP Kho 4m + VP Kho 4m + Kho mát 18.6×7m + Kho mát mở rộng 10×7m.
   * IQC 7.15×6.25m tách riêng, sát cạnh A từ Y01.
   */
  readonly OFFICE_ANCHOR_AXIS = 'Y12';
  readonly OFFICE_VPKHO_W_M = 4;
  readonly OFFICE_IQC_W_M = 7.15;
  readonly OFFICE_IQC_H_M = 6.25;
  readonly OFFICE_SECURED_W_M = 18.6;
  readonly OFFICE_KHOMAT_EXT_W_M = 10;
  readonly OFFICE_H_M = 7;
  readonly officeRooms: JwOfficeRoom[] = this.buildOfficeRooms();
  readonly officeZone = this.buildOfficeZone();
  /** Lối đi còn lại giữa hết dãy kệ và mép văn phòng */
  readonly OFFICE_AISLE_M = this.round2(this.officeZone.yM - this.OPEN_ZONE_Y_M);

  /** Kệ trong Kho mát: A01 rộng 1m, các dãy còn lại rộng 0.5m; sâu 1.5m, 3 block/dãy, cách nhau 0.8m, 7 tầng, cao 3m. */
  readonly KHO_MAT_BLOCK_W_M = 1;
  readonly KHO_MAT_BLOCK_W_NARROW_M = 0.5;
  readonly KHO_MAT_BLOCK_D_M = 1.5;
  readonly KHO_MAT_BLOCKS_PER_ROW = 3;
  readonly KHO_MAT_GAP_M = 0.8;
  readonly KHO_MAT_LEVELS = 7;
  readonly KHO_MAT_HEIGHT_M = 3;
  readonly khoMatRows: JwKhoMatRow[] = this.buildKhoMatRows();

  /** Khu xuất hàng — ước lượng theo tỷ lệ (bản vẽ gốc không ghi số đo). */
  readonly SHIPPING_AREA_W_M = 6;
  readonly SHIPPING_AREA_GAP_FROM_D_M = 3;

  /** Khu vực Nhận nguyên liệu: cách mặt A 1m, mặt C 6m, rộng 10×18m (vạch đứt, không phải vách cứng). */
  private readonly floorZoneDefs = this.buildFloorZoneDefs();

  readonly WC_EXIT_CLEARANCE_M = 1.5;

  /** Dãy kệ mặc định R1–R28 theo pitch; thêm R29 (chỉ R294–R296) sau lối 2.9m */
  readonly MAX_RACK_NUM = 30;

  racks: JwRack[] = this.buildRacks();
  aisles: JwAisleRect[] = this.buildAisles();
  /** Khe 0.3m giữa 2 dãy trong cùng cặp (R1|R2, R3|R4, …) */
  pairGaps: JwPairGapRect[] = this.buildPairGaps();
  /** Lối 1.5m giữa block 4–5–6 và 1–2–3 trong mỗi dãy kệ */
  blockGroupGaps: JwPairGapRect[] = this.buildBlockGroupGaps();

  /** Bố trí kệ J5: ngang (mặc định) hoặc dọc */
  rackLayout: JwRackLayout = 'horizontal';

  /** Chế độ kéo / resize / thêm block */
  /** Chế độ Work — gán pallet vào vị trí kệ */
  workMode = false;

  layoutEditMode = false;
  layoutDirty = false;
  layoutCustomized = false;

  get rollerDoors(): JwPlanFeature[] {
    return this.edgeFeatures.filter((f) => {
      if (f.kind !== 'roller') return false;
      if (f.edge === 'D') {
        return this.drawMode === 'dang-ky' || this.drawMode === 'ky-thuat' || this.drawMode === 'kho';
      }
      return true;
    });
  }

  /**
   * Cửa cuốn J4: cạnh A giống J5; mặt D trên Kỹ thuật / Sơ đồ kho / Đăng ký (X18–X21).
   * Cạnh E (tường ngoài phía trên) là vách kín, không có cửa.
   */
  get j4RollerDoors(): JwPlanFeature[] {
    return this.rollerDoors.filter((f) => f.edge === 'A' || f.edge === 'D');
  }

  /** Quy đổi feature cạnh A của J5 sang khung J4 (giữ nguyên hướng, đổi khung dọc). */
  j4EdgeFeatureRect(f: JwPlanFeature): { x: number; y: number; w: number; h: number } {
    const x = this.meterX(f.xM);
    const w = this.meterW(f.wM);
    const y = this.j4MeterY(f.yM);
    const h = this.j4MeterY(f.yM + f.hM) - y;
    return { x, y, w, h };
  }

  get showTechDims(): boolean {
    return this.drawMode === 'ky-thuat';
  }

  /**
   * Kích thước kỹ thuật theo CAD nhập:
   * xanh lá — phòng (dọc mép zone); xanh da trời — kệ / lối đi.
   */
  get techZoneWidthDims(): JwTechDim[] {
    if (!this.showTechDims) return [];
    const raw: JwTechDim[] = [];
    for (const r of this.officeRooms) {
      this.pushCadWidthAlongB(raw, `office-${r.id}-w`, r, false);
    }
    const secured = this.securedOfficeRoom;
    if (secured) this.pushCadHeightAlongLeft(raw, 'office-secured-h', secured, false);
    const iqc = this.officeRooms.find((r) => r.id === 'iqc');
    if (iqc) this.pushCadHeightAlongLeft(raw, 'office-iqc-h', iqc, false);
    const ext = this.khoMatExtZone;
    this.pushCadWidthAlongB(raw, 'kho-mat-ext-w', ext, false);
    this.pushCadHeightAlongLeft(raw, 'kho-mat-ext-h', ext, false);
    const inspect = this.floorZones.find((z) => z.id === 'incoming-inspect');
    if (inspect) this.pushCadWidthAlongB(raw, 'inspect-w', inspect, false);
    if (this.isVerticalRackLayout) {
      if (this.pairGaps.length) {
        this.pushAisleWidthDim(raw, 'aisle-pair-gap', this.pairGaps[0], false, 'auto', 'sky');
      }
    } else {
      this.pushPairGapDimAtR31(raw);
    }
    if (this.aisles.length) {
      this.pushAisleWidthDim(raw, 'aisle-forklift', this.aisles[0], false, 'auto', 'sky');
    }
    this.pushR33R34GapDim(raw);
    this.pushR286ToY15Dim(raw);
    const sampleRack = this.racks.find((r) => r.num === 1);
    if (sampleRack) this.pushRackOutsideDims(raw, sampleRack);
    if (this.showJ4) {
      this.pushCadHeightAlongLeft(raw, 'wc-male-h', this.j4WcMaleZone, true);
    }
    return raw;
  }

  techDimMapX(m: number): number {
    return this.meterX(m);
  }

  techDimMapY(m: number, isJ4: boolean): number {
    return isJ4 ? this.j4MeterY(m) : this.meterY(m);
  }

  trackTechDim(_: number, d: JwTechDim): string {
    return d.id;
  }

  techDimTone(d: JwTechDim): 'sky' | 'green' {
    return d.tone === 'green' ? 'green' : 'sky';
  }

  techDimMarker(d: JwTechDim): string {
    return this.techDimTone(d) === 'green' ? 'url(#jwDimArrowGreen)' : 'url(#jwDimArrowSky)';
  }

  /** Block R11 (dãy R1, block 1) — dùng làm mốc đo khoảng cách tới tường A. */
  get r11Block(): JwBlock | null {
    const rack = this.racks.find((r) => r.num === 1);
    return rack?.blocks.find((b) => b.index === 1) || null;
  }

  /** Trục kích thước A→R11: giữa block R11, xích về phía B thêm 3m để khỏi đè chữ khác. */
  get r11AisleDimYM(): number {
    const b = this.r11Block;
    if (!b) return 0;
    return this.round2(b.yM + b.hM / 2 + 3);
  }

  /** Block R286 (dãy R28, block 6) — mốc đo khoảng cách tới R296. */
  get r286Block(): JwBlock | null {
    const rack = this.racks.find((r) => r.num === 28);
    return rack?.blocks.find((b) => b.index === 6) || null;
  }

  lang: JwLang = 'vi';
  readonly langOptions: JwLangOption[] = [
    { id: 'vi', label: 'VI' },
    { id: 'en', label: 'EN' }
  ];

  get floorZones(): JwFloorZone[] {
    return this.floorZoneDefs.map((z) => {
      const label = z.labelKey ? this.t(z.labelKey) : '';
      const wrapAt = z.id === 'shipping-area' ? 20 : 12;
      return { ...z, label, labelLines: label ? this.wrapLabel(label, wrapAt) : [] };
    });
  }

  get drawModeTitle(): string {
    if (this.workMode) return this.t('work.title');
    return this.drawModeLabel(this.drawMode);
  }

  drawModeLabel(id: JwDrawMode): string {
    const keys: Record<JwDrawMode, string> = {
      'ky-thuat': 'drawMode.kyThuat',
      'hai-quan': 'drawMode.haiQuan',
      camera: 'drawMode.camera',
      kho: 'drawMode.kho',
      'dang-ky': 'drawMode.dangKy'
    };
    return this.t(keys[id]);
  }

  get headerCrumb(): string {
    return this.t('header.crumb');
  }

  /** "28.6 × 7m" — kích thước riêng của Kho mát, ghi dưới tên thay vì vẽ mũi tên như WH Office. */
  get officeSecuredMetaLabel(): string {
    return `${this.OFFICE_SECURED_W_M} × ${this.OFFICE_H_M}m`;
  }

  get officeAisleLabel(): string {
    return this.t('aisle.office', { m: this.OFFICE_AISLE_M.toFixed(2) });
  }

  get rackPairAisleLabel(): string {
    return this.t('aisle.rackPair', { m: this.AISLE_M });
  }

  get securedOfficeRoom(): JwOfficeRoom | undefined {
    return this.officeRooms.find((r) => r.id === 'secured');
  }

  officeRoomLabel(room: JwOfficeRoom): string {
    return room.labelKey ? this.t(room.labelKey) : room.label;
  }

  /** Cửa đi 0.8m — VP Kho. */
  readonly OFFICE_DOOR_W_M = 0.8;
  readonly OFFICE_DOUBLE_DOOR_W_M = 1.7;

  officeRoomDoorWidth(room: JwOfficeRoom): number {
    return this.OFFICE_DOOR_W_M;
  }

  officeRoomDoorHingeXM(room: JwOfficeRoom): number | null {
    if (!room.id.startsWith('vp-kho')) return null;
    const w = this.officeRoomDoorWidth(room);
    return this.round2(room.xM + room.wM / 2 - w / 2);
  }

  /** Trục kích thước lối đi — giữa block R161 và Secured. */
  get officeAisleDimXM(): number {
    const secured = this.securedOfficeRoom;
    if (!secured) return 0;
    const securedCx = secured.xM + secured.wM / 2;
    const rack16 = this.racks.find((r) => r.num === 16);
    const b161 = rack16?.blocks.find((b) => b.index === 1);
    const rackCx = b161
      ? b161.xM + b161.wM / 2
      : rack16
        ? rack16.xM + rack16.wM / 2
        : securedCx;
    return this.round2((securedCx + rackCx) / 2);
  }

  get raisedMetaLabel(): string {
    return this.t('raised.meta', {
      from: this.RAISED_FROM_AXIS,
      to: this.RAISED_TO_AXIS,
      w: this.raisedZone.wM.toFixed(1)
    });
  }

  get j4TitleLabel(): string {
    return this.t('j4.title');
  }

  t(key: string, params?: Record<string, string | number>): string {
    const dict = JW_I18N[this.lang] || JW_I18N.vi;
    let text = dict[key] ?? JW_I18N.vi[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
      }
    }
    return text;
  }

  featureLabel(f: JwPlanFeature): string {
    if (f.id === 'door-d') return this.t('door.gate');
    if (f.kind === 'roller') return this.t('door.roller');
    return f.label;
  }

  featureSubLabel(f: JwPlanFeature): string {
    if (f.subLabel === 'Mặt D') return this.t('door.faceD');
    return f.subLabel || '';
  }

  setLang(next: JwLang, event?: Event): void {
    event?.stopPropagation();
    if (this.lang === next) return;
    this.lang = next;
    try {
      localStorage.setItem(this.LANG_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  /** Dòng thông tin kho — sidebar (đầy đủ). */
  get warehouseInfoRows(): Array<{ label: string; value: string; icon?: 'electric'; multiline?: boolean }> {
    return [...this.warehouseInfoBaseRows, ...this.warehouseInfoExtraPalletRows];
  }

  /** Dòng thông tin kho — file tải về (không gồm pallet ngoài). */
  get warehouseInfoDownloadRows(): Array<{ label: string; value: string; icon?: 'electric'; multiline?: boolean }> {
    return this.warehouseInfoBaseRows;
  }

  private get warehouseInfoBaseRows(): Array<{ label: string; value: string; icon?: 'electric'; multiline?: boolean }> {
    return [
      { label: this.t('info.rackRows'), value: `R1–R${this.rackCount}` },
      { label: this.t('info.rackHeight'), value: `${this.RACK_HEIGHT_M}m` },
      {
        label: this.t('info.rackSize'),
        value: this.rackSizeInfoValue,
        multiline: true
      },
      { label: this.t('info.aisleForklift'), value: `${this.AISLE_M}m` },
      {
        label: this.t('info.rackGap'),
        value: `${this.isVerticalRackLayout ? this.RACK_GAP_VERTICAL_M : this.RACK_GAP_M}m`
      },
      { label: this.t('info.officeAisle'), value: `${this.OFFICE_AISLE_M.toFixed(2)}m` },
      {
        label: this.t('info.marginA'),
        value: this.t('info.marginAVal', { m: this.RACK_START_M.toFixed(2) })
      },
      { label: this.t('info.marginC'), value: `${(this.isVerticalRackLayout ? this.MARGIN_C_VERTICAL_M : this.MARGIN_C_M).toFixed(2)}m` },
      {
        label: this.t('info.office'),
        value: `${this.officeZone.wM.toFixed(2)} × ${this.officeZone.hM}m`
      },
      { label: this.t('info.raised'), value: `${this.RAISED_FROM_AXIS}–${this.RAISED_TO_AXIS}` },
      { label: this.t('info.cabinet'), value: '', icon: 'electric' },
      { label: this.t('info.levels'), value: String(this.LEVELS) }
    ];
  }

  private get warehouseInfoExtraPalletRows(): Array<{ label: string; value: string }> {
    return [
      { label: this.t('info.palletsOnRack'), value: String(this.totalPalletsJ5Rack) },
      { label: this.t('info.atLocation'), value: String(this.extraPalletAtLocation) },
      { label: this.t('info.receiveNvl'), value: String(this.extraNhanNvl) },
      { label: this.t('info.exportTp'), value: String(this.extraXuatTp) },
      { label: this.t('info.totalJ5'), value: String(this.totalPalletsJ5) }
    ];
  }

  setDrawMode(mode: JwDrawMode, event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.drawMode === mode) return;
    this.drawMode = mode;
    if (mode !== 'kho' && this.layoutEditMode) {
      this.layoutEditMode = false;
    }
  }

  /** Tách nhãn block xuống dòng nếu dài (VD R281 → R28 / 1). */
  blockLabelLines(code: string): string[] {
    const c = String(code || '').trim();
    if (c.length <= 3) return [c];
    return [c.slice(0, -1), c.slice(-1)];
  }

  zoom = 1;
  mapTool: JwMapTool = 'overview';
  infoPanelOpen = true;
  isPanning = false;
  private panDrag: { x: number; y: number; sl: number; st: number } | null = null;
  private panMoved = false;
  readonly mapTools: Array<{ id: JwMapTool; icon: string; labelKey: string }> = [
    { id: 'overview', icon: 'home', labelKey: 'tool.overview' },
    { id: 'pan', icon: 'pan_tool', labelKey: 'tool.pan' },
    { id: 'select', icon: 'highlight_alt', labelKey: 'tool.select' },
    { id: 'measure', icon: 'straighten', labelKey: 'tool.measure' },
    { id: 'note', icon: 'sticky_note_2', labelKey: 'tool.note' },
    { id: 'layers', icon: 'layers', labelKey: 'tool.layers' }
  ];
  /** Mặc định Sơ đồ Kho; chỉ Bản vẽ Kỹ Thuật hiện kích thước/khoảng cách */
  drawMode: JwDrawMode = 'kho';
  readonly drawModeIds: JwDrawMode[] = ['ky-thuat', 'hai-quan', 'camera', 'kho', 'dang-ky'];

  /** Mặc định chỉ xem J5; có thể bật xem thêm J4 (nằm sát J5, phía vách C) */
  buildingView: JwBuildingView = 'j5';
  readonly buildingViews: JwBuildingViewOption[] = [
    { id: 'j5', label: 'J5' },
    { id: 'j4-j5', label: 'J4 + J5' }
  ];

  setBuildingView(view: JwBuildingView, event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.buildingView === view) return;
    this.buildingView = view;
    setTimeout(() => this.syncViewportForBuildingView(), 0);
  }

  /** Cuộn lên đầu và zoom vừa khung khi bật J4+J5 để thấy cả 2 xưởng. */
  private syncViewportForBuildingView(): void {
    const el = this.mapViewport?.nativeElement;
    if (el) {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
    if (this.buildingView === 'j4-j5') {
      this.fitZoomForBuildingView();
    } else {
      this.resetZoom();
    }
  }

  private fitZoomForBuildingView(): void {
    const el = this.mapViewport?.nativeElement;
    if (!el) return;
    const pad = 40;
    const availH = el.clientHeight - pad;
    const availW = el.clientWidth - pad;
    if (availH <= 0 || availW <= 0) return;
    const scaleH = availH / this.viewBoxH;
    const scaleW = availW / this.viewBoxW;
    const fit = Math.min(1, scaleH, scaleW);
    this.zoom = Math.max(0.35, Math.round(fit * 100) / 100);
  }

  get showJ4(): boolean {
    return this.buildingView === 'j4-j5';
  }

  /** Bản vẽ Đăng ký: J4+J5 chung mặt C — không vẽ vạch ngăn. */
  get hideSharedFaceC(): boolean {
    return this.drawMode === 'dang-ky' && this.showJ4;
  }

  /** Bật xem 3D — mở luôn mô hình 3D toàn bộ dãy kệ J5 để kéo xoay xem chi tiết. */
  show3D = false;
  show3DModal = false;

  toggle3D(event?: Event): void {
    event?.stopPropagation();
    this.show3D = !this.show3D;
    this.show3DModal = this.show3D;
  }

  close3DModal(event?: Event): void {
    event?.stopPropagation();
    this.show3DModal = false;
    this.show3D = false;
  }

  get selectedBlockOccupancy(): Array<{ level: number; pos: JwPos; occupied: boolean }> {
    if (!this.selectedBlock) return [];
    const block = this.selectedBlock;
    const list: Array<{ level: number; pos: JwPos; occupied: boolean }> = [];
    for (const lv of this.LEVEL_LIST) {
      for (const pos of this.POS_LETTERS) {
        list.push({ level: lv, pos, occupied: !!this.palletAt(this.slotCode(block.code, lv, pos)) });
      }
    }
    return list;
  }

  onRack3dPick(pick: { level: number; pos: JwPos; blockCode?: string }): void {
    if (pick.blockCode) {
      const block = this.racks
        .flatMap((r) => r.blocks)
        .find((b) => b.code === pick.blockCode);
      if (block) this.selectedBlock = block;
    }
    this.selectedLevel = pick.level;
    this.selectedPos = pick.pos;
    this.showScanInput = false;
    this.scanPalletInput = '';
  }

  /**
   * J4 cùng kích cỡ với J5, chung vách C (không có khe hở — tường cạnh C
   * của J5 cũng chính là tường của J4). Chưa bố trí kệ/văn phòng, chưa có
   * cầu thang lên nền cao (chỉ J5 mới có).
   */
  /** Mặt D — tủ điện trong xưởng (giữa vùng R3→X21 trên bố trí cũ). */
  readonly FACE_D_EMERG_H_M = 1;
  readonly FACE_D_SPAN_GAP_M = 2;
  readonly FACE_D_R1_H_M = 2;
  readonly FACE_D_R2_H_M = 2;
  readonly FACE_D_R3_H_M = 3;
  readonly FACE_D_CAB_H_M = 4;
  readonly FACE_D_CAB_DEPTH_M = 1.2;
  readonly FACE_D_END_OUT_M = 2.4;
  readonly FACE_D_END_GAP_M = 0.35;

  /** Đầu xưởng mặt D — J5 (luôn có). */
  get j5FaceDEnd(): { xM: number; yM: number; wM: number; hM: number } {
    return {
      xM: this.round2(this.LENGTH_M + this.FACE_D_END_GAP_M),
      yM: 0,
      wM: this.FACE_D_END_OUT_M,
      hM: this.WIDTH_M
    };
  }

  /** Đầu xưởng mặt D — J4 (khi bật J4+J5). */
  get j4FaceDEnd(): { xM: number; yM: number; wM: number; hM: number } {
    return {
      xM: this.round2(this.LENGTH_M + this.FACE_D_END_GAP_M),
      yM: 0,
      wM: this.FACE_D_END_OUT_M,
      hM: this.WIDTH_M
    };
  }

  /** Vị trí tủ điện mặt D — giữa mép R3 và cột X21 (J4/J5 giống nhau). */
  get faceDCabinetZone(): { y0: number; y1: number } {
    let y = this.WIDTH_M;
    y = this.round2(y - this.FACE_D_EMERG_H_M);
    y = this.round2(y - this.FACE_D_SPAN_GAP_M - this.FACE_D_R1_H_M);
    y = this.round2(y - this.FACE_D_SPAN_GAP_M - this.FACE_D_R2_H_M);
    y = this.round2(y - this.FACE_D_SPAN_GAP_M);
    const r3Y0 = this.round2(y - this.FACE_D_R3_H_M);
    const x21Y = this.axisYM('X21');
    const cabMid = this.round2((x21Y + r3Y0) / 2);
    return {
      y0: this.round2(cabMid - this.FACE_D_CAB_H_M / 2),
      y1: this.round2(cabMid + this.FACE_D_CAB_H_M / 2)
    };
  }

  faceDWallX(): number {
    return this.meterX(this.LENGTH_M);
  }

  faceDOutX(outM: number): number {
    return this.meterX(this.LENGTH_M + outM);
  }

  /** Toạ độ trong xưởng, sát tường mặt D. */
  faceDInX(inM: number): number {
    return this.meterX(this.LENGTH_M - inM);
  }

  faceDOutW(m: number): number {
    return this.meterW(m);
  }

  faceDMapY(m: number, isJ4: boolean): number {
    return isJ4 ? this.j4MeterY(m) : this.meterY(m);
  }

  faceDMapH(m: number, isJ4: boolean): number {
    return isJ4 ? (m / this.WIDTH_M) * this.j4H : this.meterH(m);
  }

  /** Mép tủ điện hướng ra ngoài mặt D (sát tường). */
  faceDCabOuterX(): number {
    return this.faceDInX(0);
  }

  /** Nhãn J4/J5 — cột trục mặt D, bên phải đầu xưởng. */
  faceDEndTagX(): number {
    return this.faceDOutX(this.FACE_D_END_OUT_M) + 48;
  }

  /** J4 giữa X18–X19; J5 giữa X25–X26. */
  faceDEndTagY(isJ4: boolean): number {
    const yM = isJ4
      ? (this.axisYM('X23') + this.axisYM('X24')) / 2
      : (this.axisYM('X25') + this.axisYM('X26')) / 2;
    return this.faceDMapY(yM, isJ4);
  }

  /** Mũi tên Factory 3 — giữa X24 và X25, mặt D. */
  faceDFactory3Y(isJ4: boolean): number {
    const yM = (this.axisYM('X24') + this.axisYM('X25')) / 2;
    return this.faceDMapY(yM, isJ4);
  }

  /** FGs inbound — giữa Y13 và Y14, phía trên cửa cuốn mặt B. */
  fgInboundX(): number {
    return this.meterX((this.axisXM('Y13') + this.axisXM('Y14')) / 2);
  }

  fgInboundArrowY1(): number {
    return this.meterY(this.WIDTH_M - 0.95);
  }

  fgInboundArrowY2(): number {
    return this.meterY(this.WIDTH_M - 2.5);
  }

  fgInboundLabelY(): number {
    return this.meterY(this.WIDTH_M - 0.28);
  }

  faceDCabMidY(): number {
    return (this.faceDCabinetZone.y0 + this.faceDCabinetZone.y1) / 2;
  }

  faceDCabIconScale(isJ4: boolean): number {
    const w = this.faceDOutW(this.FACE_D_CAB_DEPTH_M);
    const h = this.faceDMapH(this.faceDCabinetZone.y1 - this.faceDCabinetZone.y0, isJ4);
    return (Math.min(w, h) * 0.42) / 24;
  }

  /** Path icon điện (bolt 24×24). */
  readonly electricIconPath =
    'M13 2L3 14h7l-1 8 10-12h-7l1-8z';

  readonly J4_TOP_MARGIN_PX = 70;

  get j4W(): number {
    return this.svgWidth;
  }

  get j4H(): number {
    return this.svgHeight;
  }

  get j4X(): number {
    return this.floor.x;
  }

  /** Sát J5 — cạnh dưới của J4 trùng với cạnh C (floor.y) của J5 */
  get j4Y(): number {
    return this.floor.y - this.j4H;
  }

  /** Quy đổi mét (theo trục rộng B↔C) sang toạ độ px trong khung J4 */
  j4MeterY(m: number): number {
    return this.j4Y + (m / this.WIDTH_M) * this.j4H;
  }

  /**
   * Lật toạ độ rộng (yM/hM lấy nguyên theo hệ kệ J5, vốn sát cạnh C của J5) sang khung J4,
   * để dãy kệ nằm sát cạnh C của J4 (giáp J5) thay vì lọt lên sát mặt E (chỗ của Kho Mát).
   */
  j4MirrorTopY(yM: number, hM: number): number {
    return this.j4MeterY(this.WIDTH_M - yM - hM);
  }

  j4MirrorHeight(hM: number): number {
    return (hM / this.WIDTH_M) * this.j4H;
  }

  /** Lật 1 điểm (không phải cả dải) theo cùng phép lật cạnh C ở trên — dùng cho vạch chia vị trí pallet. */
  j4MirrorY(m: number): number {
    return this.j4MeterY(this.WIDTH_M - m);
  }

  get viewBoxTopExtra(): number {
    return this.showJ4 ? this.j4H + this.J4_TOP_MARGIN_PX : 0;
  }

  get viewBoxMinY(): number {
    return -this.viewBoxTopExtra;
  }

  /** Cột J4: X16–X21 (cùng vị trí với X21–X26 trên J5). */
  readonly j4AxisXMarks: JwAxisMark[] = this.axisXMarks.map((ax, i) => ({
    ...ax,
    id: ['X16', 'X17', 'X18', 'X19', 'X20', 'X21'][i]
  }));

  /**
   * Khu J4 dọc theo trục Y: Y01–Y02 hàng KHP · Y04–Y10 Kho Mát (sát mặt E, sâu 7m).
   * Kho Mát chỉ hiện ở "Bản vẽ Đăng ký" — các bản vẽ còn lại không có.
   */
  get j4FloorZones(): JwFloorZone[] {
    const strip = this.j4OuterStripY();
    const stripH = this.round2(strip.y1 - strip.y0);
    const coldStorageX0 = this.round2(this.axisXM('Y04'));
    const coldStorageX1 = this.round2(this.axisXM('Y10'));
    const defs: Array<{ id: string; labelKey: string; xM: number; wM: number; yM: number; hM: number }> = [
      {
        id: 'j4-non-conforming',
        labelKey: 'zone.j4NonConforming',
        xM: 0,
        wM: this.round2(this.axisXM('Y02')),
        yM: strip.y0,
        hM: stripH
      }
    ];
    if (this.drawMode === 'dang-ky') {
      defs.push({
        id: 'j4-cold-storage',
        labelKey: 'zone.j4ColdStorage',
        xM: coldStorageX0,
        wM: this.round2(coldStorageX1 - coldStorageX0),
        yM: strip.y0,
        hM: 7
      });
    }
    return defs.map((z) => {
      const label = this.t(z.labelKey);
      return {
        id: z.id,
        label,
        labelLines: this.wrapLabel(label),
        xM: z.xM,
        yM: z.yM,
        wM: z.wM,
        hM: z.hM
      };
    });
  }

  /** Dải X16–X17 (X21–X22 trên J5) sát tường ngoài J4 */
  private j4OuterStripY(): { y0: number; y1: number } {
    const y0 = this.axisYM('X21');
    const y1 = this.axisYM('X22');
    return { y0: Math.min(y0, y1), y1: Math.max(y0, y1) };
  }

  selectedBlock: JwBlock | null = null;
  selectedLevel = 1;
  selectedPos: JwPos = 'A';

  slotPallets = new Map<string, string>();
  scanPalletInput = '';
  showScanInput = false;
  isSavingPallet = false;
  isClearingPallet = false;
  isDownloading = false;
  lastUpdated: Date | null = null;

  showExtraPalletModal = false;
  extraPalletAtLocation = 0;
  extraNhanNvl = 0;
  extraXuatTp = 0;
  extraPalletDraft = {
    atLocation: 0,
    nhanNvl: 0,
    xuatTp: 0
  };

  get extraPalletDraftTotal(): number {
    return (
      this.totalPalletsJ5Rack +
      this.normalizeExtraCount(this.extraPalletDraft.atLocation) +
      this.normalizeExtraCount(this.extraPalletDraft.nhanNvl) +
      this.normalizeExtraCount(this.extraPalletDraft.xuatTp)
    );
  }

  @ViewChild('scanPalletInputRef') scanPalletInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('planSvg') planSvg?: ElementRef<SVGSVGElement>;
  @ViewChild('mapViewport') mapViewport?: ElementRef<HTMLElement>;

  private layoutDrag: {
    kind: JwLayoutDragKind;
    block: JwBlock;
    /** Khi move: cả dãy kệ (các block cùng rackNum) — không kéo dãy cặp bên cạnh */
    rackBlocks: Array<{ block: JwBlock; origXM: number; origYM: number; origWM: number; origHM: number }>;
    startXM: number;
    startYM: number;
  } | null = null;
  private layoutDragMoved = false;

  get pairCount(): number {
    return this.racks.length / 2;
  }

  get rackCount(): number {
    return this.racks.length;
  }

  get slotsPerRack(): number {
    const shortN = this.BLOCK_SHORT_INDICES.length;
    return (
      (this.BLOCKS_PER_RACK - shortN) * this.PALLETS_LONG_BLOCK +
      shortN * this.PALLETS_SHORT_BLOCK
    );
  }

  isShortBlock(block: JwBlock): boolean {
    return this.BLOCK_SHORT_INDICES.includes(block.index);
  }

  palletsInBlock(block: JwBlock): number {
    return this.isShortBlock(block) ? this.PALLETS_SHORT_BLOCK : this.PALLETS_LONG_BLOCK;
  }

  get longBlockCount(): number {
    return this.racks.reduce(
      (n, r) => n + r.blocks.filter((b) => !this.isShortBlock(b)).length,
      0
    );
  }

  get shortBlockCount(): number {
    return this.racks.reduce(
      (n, r) => n + r.blocks.filter((b) => this.isShortBlock(b)).length,
      0
    );
  }

  get rackSizeInfoValue(): string {
    return [
      this.t('info.rackSizeLine', {
        l: this.BLOCK_SHORT_LEN_M,
        w: this.RACK_DEPTH_M,
        n: this.shortBlockCount
      }),
      this.t('info.rackSizeLine', {
        l: this.BLOCK_LEN_M,
        w: this.RACK_DEPTH_M,
        n: this.longBlockCount
      })
    ].join('\n');
  }

  /** Tổng pallet trên kệ J5 (chưa cộng dữ liệu ngoài) */
  get totalPalletsJ5Rack(): number {
    return (
      this.longBlockCount * this.PALLETS_LONG_BLOCK +
      this.shortBlockCount * this.PALLETS_SHORT_BLOCK
    );
  }

  /** Tổng pallet J5 = kệ + pallet vị trí + nhận NVL + xuất TP */
  get totalPalletsJ5(): number {
    return (
      this.totalPalletsJ5Rack +
      this.extraPalletAtLocation +
      this.extraNhanNvl +
      this.extraXuatTp
    );
  }

  get totalSlots(): number {
    return this.totalPalletsJ5;
  }

  get occupiedCount(): number {
    return this.slotPallets.size;
  }

  get showDefaultAisles(): boolean {
    return !this.layoutCustomized && !this.layoutEditMode;
  }

  get isVerticalRackLayout(): boolean {
    return this.rackLayout === 'vertical';
  }

  /** Block dài theo trục nào (m) — dùng vẽ vạch pallet. */
  blockLengthM(block: JwBlock): number {
    return block.wM >= block.hM ? block.wM : block.hM;
  }

  blockDepthM(block: JwBlock): number {
    return block.wM >= block.hM ? block.hM : block.wM;
  }

  blockPalletAlongX(block: JwBlock): boolean {
    return block.wM > block.hM;
  }

  get selectedSlotCode(): string {
    if (!this.selectedBlock) return '';
    return this.slotCode(this.selectedBlock.code, this.selectedLevel, this.selectedPos);
  }

  get selectedPallet(): string {
    return this.palletAt(this.selectedSlotCode);
  }

  get viewBoxW(): number {
    return this.svgWidth + this.padL + this.padR;
  }

  get viewBoxH(): number {
    return this.svgHeight + this.padT + this.padB + this.viewBoxTopExtra;
  }

  get viewBox(): string {
    return `0 ${this.viewBoxMinY} ${this.viewBoxW} ${this.viewBoxH}`;
  }

  get floor() {
    return {
      x: this.padL,
      y: this.padT,
      w: this.svgWidth,
      h: this.svgHeight
    };
  }

  constructor(
    private router: Router,
    private location: Location,
    private firestore: AngularFirestore
  ) {}

  ngOnInit(): void {
    this.loadLang();
    this.loadSavedLayout();
    this.loadExtraPallets();
    void this.loadSlotPallets();
  }

  private loadLang(): void {
    try {
      const raw = localStorage.getItem(this.LANG_STORAGE_KEY);
      if (raw === 'vi' || raw === 'en') this.lang = raw;
    } catch {
      /* ignore */
    }
  }

  openExtraPalletModal(event?: Event): void {
    event?.stopPropagation();
    this.extraPalletDraft = {
      atLocation: this.extraPalletAtLocation,
      nhanNvl: this.extraNhanNvl,
      xuatTp: this.extraXuatTp
    };
    this.showExtraPalletModal = true;
  }

  closeExtraPalletModal(event?: Event): void {
    event?.stopPropagation();
    this.showExtraPalletModal = false;
  }

  saveExtraPallets(event?: Event): void {
    event?.stopPropagation();
    this.extraPalletAtLocation = this.normalizeExtraCount(this.extraPalletDraft.atLocation);
    this.extraNhanNvl = this.normalizeExtraCount(this.extraPalletDraft.nhanNvl);
    this.extraXuatTp = this.normalizeExtraCount(this.extraPalletDraft.xuatTp);
    try {
      localStorage.setItem(
        this.EXTRA_PALLET_STORAGE_KEY,
        JSON.stringify({
          atLocation: this.extraPalletAtLocation,
          nhanNvl: this.extraNhanNvl,
          xuatTp: this.extraXuatTp
        })
      );
    } catch (err) {
      console.error('[JWarehouse] saveExtraPallets failed', err);
    }
    this.showExtraPalletModal = false;
  }

  private loadExtraPallets(): void {
    try {
      const raw = localStorage.getItem(this.EXTRA_PALLET_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as {
        atLocation?: number;
        nhanNvl?: number;
        xuatTp?: number;
      };
      this.extraPalletAtLocation = this.normalizeExtraCount(data?.atLocation);
      this.extraNhanNvl = this.normalizeExtraCount(data?.nhanNvl);
      this.extraXuatTp = this.normalizeExtraCount(data?.xuatTp);
    } catch (err) {
      console.error('[JWarehouse] loadExtraPallets failed', err);
    }
  }

  private normalizeExtraCount(n: number | string | undefined | null): number {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) return 0;
    return Math.round(v);
  }

  toggleWorkMode(event?: Event): void {
    event?.stopPropagation();
    this.workMode = !this.workMode;
    this.layoutEditMode = false;
    this.layoutDrag = null;
    this.showScanInput = false;
    if (this.workMode) {
      this.drawMode = 'kho';
      this.show3DModal = false;
    } else {
      this.clearSelection();
    }
  }

  toggleLayoutEdit(event?: Event): void {
    event?.stopPropagation();
    this.layoutEditMode = !this.layoutEditMode;
    this.layoutDrag = null;
    if (this.layoutEditMode) {
      this.showScanInput = false;
    }
  }

  saveLayout(event?: Event): void {
    event?.stopPropagation();
    const payload = {
      version: 2 as const,
      rackLayout: this.rackLayout,
      savedAt: new Date().toISOString(),
      racks: this.racks.map((r) => ({
        id: r.id,
        num: r.num,
        pairIndex: r.pairIndex,
        isInner: r.isInner,
        blocks: r.blocks.map((b) => ({
          code: b.code,
          rackNum: b.rackNum,
          index: b.index,
          xM: b.xM,
          yM: b.yM,
          wM: b.wM,
          hM: b.hM
        }))
      }))
    };
    try {
      localStorage.setItem(this.LAYOUT_STORAGE_KEY, JSON.stringify(payload));
      this.layoutDirty = false;
      this.layoutCustomized = true;
    } catch (err) {
      console.error('[JWarehouse] saveLayout failed', err);
    }
  }

  resetLayout(event?: Event): void {
    event?.stopPropagation();
    if (!confirm('Khôi phục layout kệ mặc định? Thay đổi chưa lưu sẽ mất.')) return;
    try {
      localStorage.removeItem(this.LAYOUT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    this.rackLayout = 'horizontal';
    this.rebuildRackLayout();
    this.layoutDirty = false;
    this.layoutCustomized = false;
    this.layoutDrag = null;
    this.clearSelection();
  }

  /** Xếp dọc J5 — cặp kệ theo trục Y, thân kệ chạy dọc theo chiều dài kho, tự căn & lưu. */
  applyVerticalRackLayout(event?: Event): void {
    event?.stopPropagation();
    this.rackLayout = 'vertical';
    this.rebuildRackLayout();
    this.layoutCustomized = false;
    this.layoutDirty = false;
    this.layoutDrag = null;
    this.clearSelection();
    this.saveLayout();
  }

  private rebuildRackLayout(): void {
    this.racks = this.buildRacks();
    this.aisles = this.buildAisles();
    this.pairGaps = this.buildPairGaps();
    this.blockGroupGaps = this.buildBlockGroupGaps();
  }

  addBlock(event?: Event): void {
    event?.stopPropagation();
    if (!this.layoutEditMode) return;

    if (this.selectedBlock) {
      const rack = this.racks.find((r) => r.num === this.selectedBlock!.rackNum);
      if (!rack) return;
      const nextIndex = Math.max(0, ...rack.blocks.map((b) => b.index)) + 1;
      const src = this.selectedBlock;
      const block: JwBlock = {
        code: this.blockCode(rack.num, nextIndex),
        rackNum: rack.num,
        index: nextIndex,
        xM: src.xM,
        yM: this.round2(src.yM + src.hM + this.UPRIGHT_M),
        wM: src.wM,
        hM: src.hM
      };
      this.clampBlock(block);
      rack.blocks.push(block);
      this.syncRackBounds(rack);
      this.selectedBlock = block;
    } else {
      const num = Math.max(0, ...this.racks.map((r) => r.num)) + 1;
      const block: JwBlock = {
        code: this.blockCode(num, 1),
        rackNum: num,
        index: 1,
        xM: this.round2(this.RACK_START_M),
        yM: this.MARGIN_C_M + this.UPRIGHT_M,
        wM: this.RACK_DEPTH_M,
        hM: this.blockLenM(1)
      };
      this.clampBlock(block);
      const rack: JwRack = {
        id: `R${num}`,
        num,
        pairIndex: Math.floor((num - 1) / 2),
        isInner: num % 2 === 1,
        xM: block.xM,
        yM: block.yM,
        wM: block.wM,
        hM: block.hM,
        blocks: [block]
      };
      this.racks = [...this.racks, rack];
      this.selectedBlock = block;
    }

    this.markLayoutDirty();
  }

  deleteSelectedBlock(event?: Event): void {
    event?.stopPropagation();
    if (!this.layoutEditMode || !this.selectedBlock) return;
    const code = this.selectedBlock.code;
    if (!confirm(`Xóa block ${code}?`)) return;

    const rack = this.racks.find((r) => r.num === this.selectedBlock!.rackNum);
    if (!rack) return;
    rack.blocks = rack.blocks.filter((b) => b.code !== code);
    if (!rack.blocks.length) {
      this.racks = this.racks.filter((r) => r.num !== rack.num);
    } else {
      this.syncRackBounds(rack);
    }
    this.clearSelection();
    this.markLayoutDirty();
  }

  onBlockPointerDown(block: JwBlock, event: PointerEvent): void {
    if (this.mapTool === 'pan') return;
    event.stopPropagation();
    this.selectedBlock = block;
    this.selectedLevel = 1;
    this.selectedPos = 'A';
    this.showScanInput = false;
    this.scanPalletInput = '';

    if (!this.workMode && !this.showTechDims) {
      return;
    }

    if (!this.layoutEditMode || event.button !== 0) return;

    const pt = this.clientToMeter(event.clientX, event.clientY);
    if (!pt) return;
    const rack = this.racks.find((r) => r.num === block.rackNum);
    const rackBlocks = (rack?.blocks || [block]).map((b) => ({
      block: b,
      origXM: b.xM,
      origYM: b.yM,
      origWM: b.wM,
      origHM: b.hM
    }));
    this.layoutDrag = {
      kind: 'move',
      block,
      rackBlocks,
      startXM: pt.xM,
      startYM: pt.yM
    };
    this.layoutDragMoved = false;
    (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
  }

  onResizePointerDown(block: JwBlock, event: PointerEvent): void {
    event.stopPropagation();
    event.preventDefault();
    if (!this.layoutEditMode || event.button !== 0) return;
    this.selectedBlock = block;
    const pt = this.clientToMeter(event.clientX, event.clientY);
    if (!pt) return;
    this.layoutDrag = {
      kind: 'resize',
      block,
      rackBlocks: [
        {
          block,
          origXM: block.xM,
          origYM: block.yM,
          origWM: block.wM,
          origHM: block.hM
        }
      ],
      startXM: pt.xM,
      startYM: pt.yM
    };
    this.layoutDragMoved = false;
    (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
  }

  @HostListener('window:pointermove', ['$event'])
  onWindowPointerMove(event: PointerEvent): void {
    if (!this.layoutDrag) return;
    const pt = this.clientToMeter(event.clientX, event.clientY);
    if (!pt) return;
    const d = this.layoutDrag;
    const dx = pt.xM - d.startXM;
    const dy = pt.yM - d.startYM;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;
    this.layoutDragMoved = true;

    if (d.kind === 'move') {
      // Chỉ dãy kệ đang kéo (vd R1) — không đụng R2 cặp bên; giữ nguyên khoảng cách nội bộ
      let dxUse = dx;
      let dyUse = dy;

      const bounds = (ox: number, oy: number) => {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const item of d.rackBlocks) {
          const x = item.origXM + ox;
          const y = item.origYM + oy;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + item.block.wM);
          maxY = Math.max(maxY, y + item.block.hM);
        }
        return { minX, minY, maxX, maxY };
      };

      let b = bounds(dxUse, dyUse);
      if (b.minX < 0) dxUse -= b.minX;
      if (b.minY < 0) dyUse -= b.minY;
      b = bounds(dxUse, dyUse);
      if (b.maxX > this.LENGTH_M) dxUse -= b.maxX - this.LENGTH_M;
      if (b.maxY > this.WIDTH_M) dyUse -= b.maxY - this.WIDTH_M;

      for (const item of d.rackBlocks) {
        item.block.xM = this.snap(item.origXM + dxUse);
        item.block.yM = this.snap(item.origYM + dyUse);
      }
    } else {
      const item = d.rackBlocks[0];
      if (!item) return;
      item.block.wM = this.snap(Math.max(this.BLOCK_MIN_W_M, item.origWM + dx));
      item.block.hM = this.snap(Math.max(this.BLOCK_MIN_H_M, item.origHM + dy));
      this.clampBlock(item.block);
    }
    const rack = this.racks.find((r) => r.num === d.block.rackNum);
    if (rack) this.syncRackBounds(rack);
  }

  @HostListener('window:pointerup')
  @HostListener('window:pointercancel')
  onWindowPointerUp(): void {
    if (!this.layoutDrag) return;
    const moved = this.layoutDragMoved;
    this.layoutDrag = null;
    this.layoutDragMoved = false;
    if (moved) this.markLayoutDirty();
  }

  blockPalletStep(block: JwBlock): number {
    return this.round2(this.blockLengthM(block) / this.PALLETS_PER_BLOCK);
  }

  private loadSavedLayout(): void {
    try {
      const raw = localStorage.getItem(this.LAYOUT_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as {
        version?: number;
        rackLayout?: JwRackLayout;
        racks?: Array<{
          id: string;
          num: number;
          pairIndex: number;
          isInner: boolean;
          blocks: JwBlock[];
        }>;
      };
      if (!data?.racks?.length) return;
      if (data.rackLayout === 'vertical' || data.rackLayout === 'horizontal') {
        this.rackLayout = data.rackLayout;
      }
      this.racks = data.racks.map((r) => {
        const blocks = (r.blocks || []).map((b) => ({
          code: String(b.code),
          rackNum: Number(b.rackNum),
          index: Number(b.index),
          xM: this.round2(Number(b.xM)),
          yM: this.round2(Number(b.yM)),
          wM: this.round2(Number(b.wM)),
          hM: this.round2(Number(b.hM))
        }));
        const rack: JwRack = {
          id: r.id || `R${r.num}`,
          num: r.num,
          pairIndex: r.pairIndex,
          isInner: !!r.isInner,
          xM: 0,
          yM: 0,
          wM: 0,
          hM: 0,
          blocks
        };
        this.syncRackBounds(rack);
        return rack;
      });
      this.aisles = this.buildAisles();
      this.pairGaps = this.buildPairGaps();
      this.blockGroupGaps = this.buildBlockGroupGaps();
      this.layoutCustomized = true;
      this.layoutDirty = false;
    } catch (err) {
      console.error('[JWarehouse] loadSavedLayout failed', err);
    }
  }

  private markLayoutDirty(): void {
    this.layoutDirty = true;
    this.layoutCustomized = true;
  }

  private snap(n: number): number {
    const s = this.LAYOUT_SNAP_M;
    return this.round2(Math.round(n / s) * s);
  }

  private clampBlock(block: JwBlock): void {
    block.wM = this.round2(Math.max(this.BLOCK_MIN_W_M, Math.min(block.wM, this.LENGTH_M)));
    block.hM = this.round2(Math.max(this.BLOCK_MIN_H_M, Math.min(block.hM, this.WIDTH_M)));
    block.xM = this.round2(Math.max(0, Math.min(block.xM, this.LENGTH_M - block.wM)));
    block.yM = this.round2(Math.max(0, Math.min(block.yM, this.WIDTH_M - block.hM)));
  }

  private syncRackBounds(rack: JwRack): void {
    if (!rack.blocks.length) return;
    const minX = Math.min(...rack.blocks.map((b) => b.xM));
    const minY = Math.min(...rack.blocks.map((b) => b.yM));
    const maxX = Math.max(...rack.blocks.map((b) => b.xM + b.wM));
    const maxY = Math.max(...rack.blocks.map((b) => b.yM + b.hM));
    rack.xM = this.round2(minX);
    rack.yM = this.round2(minY);
    rack.wM = this.round2(maxX - minX);
    rack.hM = this.round2(maxY - minY);
  }

  private clientToMeter(clientX: number, clientY: number): { xM: number; yM: number } | null {
    const svg = this.planSvg?.nativeElement;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    const xM = this.VIEW_X0_M + ((p.x - this.floor.x) / this.floor.w) * this.VIEW_LENGTH_M;
    const yM = this.VIEW_Y0_M + ((p.y - this.floor.y) / this.floor.h) * this.VIEW_WIDTH_M;
    return { xM, yM };
  }

  meterX(m: number): number {
    return this.floor.x + ((m - this.VIEW_X0_M) / this.VIEW_LENGTH_M) * this.floor.w;
  }

  meterY(m: number): number {
    return this.floor.y + ((m - this.VIEW_Y0_M) / this.VIEW_WIDTH_M) * this.floor.h;
  }

  meterW(m: number): number {
    return (m / this.VIEW_LENGTH_M) * this.floor.w;
  }

  meterH(m: number): number {
    return (m / this.VIEW_WIDTH_M) * this.floor.h;
  }

  /** R{dãy}{block} → R11 */
  blockCode(rackNum: number, blockIndex: number): string {
    return `R${rackNum}${blockIndex}`;
  }

  blockLenM(blockIndex: number): number {
    return this.BLOCK_SHORT_INDICES.includes(blockIndex)
      ? this.BLOCK_SHORT_LEN_M
      : this.BLOCK_LEN_M;
  }

  /** R11-1A */
  slotCode(blockCode: string, level: number, pos: JwPos): string {
    return `${blockCode}-${level}${pos}`;
  }

  palletAt(slotCode: string): string {
    return this.slotPallets.get(slotCode) || '';
  }

  blockOccupiedCount(block: JwBlock): number {
    let n = 0;
    for (const lv of this.LEVEL_LIST) {
      for (const pos of this.POS_LETTERS) {
        if (this.palletAt(this.slotCode(block.code, lv, pos))) n++;
      }
    }
    return n;
  }

  isBlockSelected(block: JwBlock): boolean {
    return this.selectedBlock?.code === block.code;
  }

  selectBlock(block: JwBlock, event?: Event): void {
    event?.stopPropagation();
    this.selectedBlock = block;
    this.selectedLevel = 1;
    this.selectedPos = 'A';
    this.showScanInput = false;
    this.scanPalletInput = '';
  }

  selectLevel(level: number): void {
    this.selectedLevel = level;
    this.showScanInput = false;
    this.scanPalletInput = '';
  }

  selectPos(pos: JwPos): void {
    this.selectedPos = pos;
    this.showScanInput = false;
    this.scanPalletInput = '';
  }

  clearSelection(): void {
    this.selectedBlock = null;
    this.showScanInput = false;
    this.scanPalletInput = '';
  }

  /** Chỉ bỏ chọn khi click nền sơ đồ — không xóa panel Work khi thả chuột trên block. */
  onViewportClick(event: MouseEvent): void {
    if (this.mapTool === 'pan' && this.panMoved) return;
    const target = event.target as Element | null;
    if (target?.closest('.jw-block')) return;
    this.clearSelection();
  }

  setMapTool(tool: JwMapTool, event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();
    if (tool === 'overview') {
      this.mapTool = 'overview';
      this.resetZoom();
      this.clearSelection();
      return;
    }
    if (tool === 'measure') {
      this.mapTool = 'measure';
      if (this.drawMode !== 'ky-thuat') this.setDrawMode('ky-thuat', event);
      return;
    }
    this.mapTool = tool;
  }

  printDrawing(event?: Event): void {
    event?.stopPropagation();
    window.print();
  }

  toggleInfoPanel(event?: Event): void {
    event?.stopPropagation();
    this.infoPanelOpen = !this.infoPanelOpen;
  }

  toggleMapFullscreen(event?: Event): void {
    event?.stopPropagation();
    const el = this.mapViewport?.nativeElement;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void el.requestFullscreen();
  }

  onViewportPointerDown(event: PointerEvent): void {
    if (this.mapTool !== 'pan' || event.button !== 0) return;
    const el = this.mapViewport?.nativeElement;
    if (!el) return;
    this.panMoved = false;
    this.isPanning = true;
    this.panDrag = { x: event.clientX, y: event.clientY, sl: el.scrollLeft, st: el.scrollTop };
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  }

  onViewportPointerMove(event: PointerEvent): void {
    if (!this.panDrag) return;
    const el = this.mapViewport?.nativeElement;
    if (!el) return;
    const dx = event.clientX - this.panDrag.x;
    const dy = event.clientY - this.panDrag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) this.panMoved = true;
    el.scrollLeft = this.panDrag.sl - dx;
    el.scrollTop = this.panDrag.st - dy;
  }

  onViewportPointerUp(): void {
    this.panDrag = null;
    this.isPanning = false;
  }

  onBlockClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  setZoom(delta: number): void {
    this.zoom = Math.min(6, Math.max(0.35, Math.round((this.zoom + delta) * 100) / 100));
  }

  setZoomFromSlider(value: number | string): void {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    this.zoom = Math.min(6, Math.max(0.35, n));
  }

  resetZoom(): void {
    this.zoom = 1;
  }

  onViewportWheel(event: WheelEvent): void {
    event.preventDefault();
    this.setZoom(event.deltaY > 0 ? -0.15 : 0.15);
  }

  onZoomBtn(delta: number, event?: Event): void {
    event?.stopPropagation();
    this.setZoom(delta);
  }

  /** Xuất bản vẽ đang xem + Thông tin kho thành file PNG. */
  downloadDrawing(event?: Event): void {
    event?.stopPropagation();
    const svg = this.planSvg?.nativeElement;
    if (!svg || this.isDownloading) return;
    this.isDownloading = true;

    try {
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.removeAttribute('style');
      clone.setAttribute('width', String(this.viewBoxW));
      clone.setAttribute('height', String(this.viewBoxH));

      const cssText = this.collectStylesheetCss();
      const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      styleEl.textContent = cssText;
      clone.insertBefore(styleEl, clone.firstChild);

      const svgString = new XMLSerializer().serializeToString(clone);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        try {
          const scale = 2;
          const infoW = 360 * scale;
          const gap = 16 * scale;
          const canvas = document.createElement('canvas');
          canvas.width = this.viewBoxW * scale + gap + infoW;
          canvas.height = this.viewBoxH * scale;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('canvas context unavailable');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, this.viewBoxW * scale, this.viewBoxH * scale);
          this.drawWarehouseInfoOnCanvas(
            ctx,
            this.viewBoxW * scale + gap,
            0,
            infoW,
            canvas.height,
            scale
          );
          canvas.toBlob((blob) => {
            if (blob) {
              const link = document.createElement('a');
              link.href = URL.createObjectURL(blob);
              link.download = `j-warehouse-${this.lang}-${this.drawMode}-${this.buildingView}.png`;
              link.click();
              setTimeout(() => URL.revokeObjectURL(link.href), 2000);
            }
            URL.revokeObjectURL(svgUrl);
            this.isDownloading = false;
          }, 'image/png');
        } catch (e) {
          console.error('[JWarehouse] downloadDrawing render failed', e);
          URL.revokeObjectURL(svgUrl);
          this.isDownloading = false;
          alert(this.t('alert.exportError'));
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(svgUrl);
        this.isDownloading = false;
        alert(this.t('alert.exportError'));
      };
      img.src = svgUrl;
    } catch (e) {
      console.error('[JWarehouse] downloadDrawing failed', e);
      this.isDownloading = false;
      alert(this.t('alert.exportError'));
    }
  }

  private drawWarehouseInfoOnCanvas(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    scale: number
  ): void {
    const pad = 18 * scale;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5 * scale;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5 * scale, y + 0.5 * scale, w - scale, h - scale);

    let cy = y + pad;
    ctx.fillStyle = '#000000';
    ctx.font = `${16 * scale}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(this.t('info.title'), x + pad, cy);
    cy += 28 * scale;

    ctx.font = `${13 * scale}px "Segoe UI", system-ui, sans-serif`;
    const labelW = 190 * scale;
    const rowH = 22 * scale;
    for (const row of this.warehouseInfoDownloadRows) {
      ctx.fillStyle = '#444444';
      ctx.fillText(row.label, x + pad, cy);
      ctx.fillStyle = '#000000';
      const valueLines = row.icon === 'electric' ? ['⚡'] : String(row.value || '').split('\n');
      for (let i = 0; i < valueLines.length; i++) {
        if (i > 0) cy += rowH;
        ctx.fillText(valueLines[i], x + pad + labelW, cy);
      }
      cy += rowH;
    }

    ctx.restore();
  }

  /** Gom CSS từ các stylesheet đang tải để nhúng vào SVG xuất ra (bỏ qua sheet chặn CORS). */
  private collectStylesheetCss(): string {
    const chunks: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = (sheet as CSSStyleSheet).cssRules;
        for (const rule of Array.from(rules)) {
          chunks.push(rule.cssText);
        }
      } catch {
        /* stylesheet chặn CORS — bỏ qua */
      }
    }
    return chunks.join('\n');
  }

  openScanForSelectedSlot(): void {
    if (!this.selectedBlock) return;
    if (this.selectedPallet) {
      alert('Vị trí này đã có pallet. Xóa pallet hiện tại trước khi gán mới.');
      return;
    }
    this.showScanInput = true;
    this.scanPalletInput = '';
    setTimeout(() => this.scanPalletInputRef?.nativeElement?.focus(), 0);
  }

  cancelScanPallet(): void {
    this.showScanInput = false;
    this.scanPalletInput = '';
  }

  async submitScanPallet(): Promise<void> {
    if (!this.selectedBlock || this.isSavingPallet) return;
    const code = this.normalizePalletCode(this.scanPalletInput);
    if (!code) return;

    if (!/^P\d{4}$/.test(code)) {
      alert('Mã pallet không hợp lệ. Chỉ cần nhập 4 số (vd: 1234 → P1234) hoặc quét đủ dạng P1234.');
      return;
    }

    const slot = this.selectedSlotCode;
    if (this.palletAt(slot)) {
      alert('Vị trí này đã có pallet. Mỗi vị trí chỉ được gán một pallet.');
      return;
    }

    const duplicateSlot = this.findSlotByPallet(code);
    if (duplicateSlot) {
      alert(`Pallet "${code}" đã được gán tại ${duplicateSlot}. Mỗi pallet chỉ được gán một vị trí.`);
      return;
    }

    this.isSavingPallet = true;
    try {
      await this.firestore.collection(this.SLOT_PALLET_COLLECTION).doc(slot).set({
        slotName: slot,
        palletCode: code,
        updatedAt: new Date()
      });
      this.slotPallets.set(slot, code);
      this.slotPallets = new Map(this.slotPallets);
      this.lastUpdated = new Date();
      this.showScanInput = false;
      this.scanPalletInput = '';

      const synced = await this.syncInventoryForPallet(code, slot);
      if (synced === 0) {
        alert(
          `Đã gán pallet "${code}" tại ${slot} trên sơ đồ.\n\n` +
            `Chưa tìm thấy mã NVL (ASM1/ASM2) để ghi cột Pallet / Vị trí.\n` +
            `Pallet vẫn được lưu trên sơ đồ.`
        );
      }
    } catch (e) {
      console.error('[JWarehouse] submitScanPallet failed', e);
      alert('Lỗi khi lưu pallet. Vui lòng thử lại.');
    } finally {
      this.isSavingPallet = false;
    }
  }

  async clearSelectedPallet(): Promise<void> {
    if (!this.selectedBlock || this.isClearingPallet) return;
    const slot = this.selectedSlotCode;
    const code = this.palletAt(slot);
    if (!code) return;
    if (!confirm(`Xóa pallet "${code}" khỏi vị trí ${slot}?`)) return;

    this.isClearingPallet = true;
    try {
      await this.firestore.collection(this.SLOT_PALLET_COLLECTION).doc(slot).delete();
      this.slotPallets.delete(slot);
      this.slotPallets = new Map(this.slotPallets);
      this.lastUpdated = new Date();
    } catch (e) {
      console.error('[JWarehouse] clearSelectedPallet failed', e);
      alert('Lỗi khi xóa pallet. Vui lòng thử lại.');
    } finally {
      this.isClearingPallet = false;
    }
  }

  goBack(): void {
    this.location.back();
  }

  goToMenu(): void {
    void this.router.navigate(['/menu']);
  }

  trackRack(_: number, r: JwRack): string {
    return r.id;
  }

  trackBlock(_: number, b: JwBlock): string {
    return b.code;
  }

  trackAxis(_: number, a: JwAxisMark): string {
    return a.id;
  }

  trackFeature(_: number, f: JwPlanFeature): string {
    return f.id;
  }

  trackOfficeRoom(_: number, r: JwOfficeRoom): string {
    return r.id;
  }

  trackFloorZone(_: number, z: JwFloorZone): string {
    return z.id;
  }

  private formatDimM(n: number): string {
    const r = this.round2(n);
    return Number.isInteger(r) ? `${r}m` : `${r}m`;
  }

  /** Dưới ngưỡng này, đường kích thước 2 đầu mũi tên sẽ vỡ hình (mũi tên đè lên nhau) → dùng 1 mũi tên dẫn thay thế. */
  private static readonly NARROW_GAP_LEADER_M = 1.6;

  /**
   * Chỉ đo cạnh hẹp của lối đi (độ rộng lối).
   * `axis` ép đo theo 1 trục cụ thể khi cạnh hẹp hình học không phải là kích thước thật của lối đi
   * (VD: lối 1.5m giữa 2 nhóm block trong 1 kệ có bề ngang kệ 1m < 1.5m, nhưng kích thước cần ghi là 1.5m).
   */
  private pushAisleWidthDim(
    out: JwTechDim[],
    id: string,
    rect: { xM: number; yM: number; wM: number; hM: number },
    isJ4: boolean,
    axis: 'auto' | 'w' | 'h' = 'auto',
    tone: 'sky' | 'green' = 'sky'
  ): void {
    const w = this.round2(rect.wM);
    const h = this.round2(rect.hM);
    const useW = axis === 'auto' ? w <= h : axis === 'w';
    if (useW) {
      if (w < JWarehouseComponent.NARROW_GAP_LEADER_M) {
        const midX = this.round2(rect.xM + w / 2);
        const midY = this.round2(rect.yM + h / 2);
        out.push({
          id: `${id}-w`,
          isJ4,
          x1M: midX,
          y1M: this.round2(rect.yM + Math.min(0.4, h * 0.15)),
          x2M: midX,
          y2M: this.round2(rect.yM + h - Math.min(0.4, h * 0.15)),
          label: this.formatDimM(w),
          txM: midX,
          tyM: midY,
          rotate: true,
          tone
        });
        return;
      }
      const yLine = this.round2(rect.yM + Math.min(1.2, Math.max(0.45, h * 0.12)));
      out.push({
        id: `${id}-w`,
        isJ4,
        x1M: rect.xM,
        y1M: yLine,
        x2M: this.round2(rect.xM + w),
        y2M: yLine,
        label: this.formatDimM(w),
        txM: this.round2(rect.xM + w / 2),
        tyM: this.round2(Math.min(rect.yM + h - 0.25, yLine + 0.4)),
        rotate: false,
        tone
      });
      return;
    }
    if (h < JWarehouseComponent.NARROW_GAP_LEADER_M) {
      const midX = this.round2(rect.xM + w / 2);
      const midY = this.round2(rect.yM + h / 2);
      out.push({
        id: `${id}-h`,
        isJ4,
        x1M: this.round2(rect.xM + Math.min(0.4, w * 0.15)),
        y1M: midY,
        x2M: this.round2(rect.xM + w - Math.min(0.4, w * 0.15)),
        y2M: midY,
        label: this.formatDimM(h),
        txM: midX,
        tyM: midY,
        rotate: false,
        tone
      });
      return;
    }
    const xLine = this.round2(rect.xM + Math.min(1.2, Math.max(0.45, w * 0.12)));
    out.push({
      id: `${id}-h`,
      isJ4,
      x1M: xLine,
      y1M: rect.yM,
      x2M: xLine,
      y2M: this.round2(rect.yM + h),
      label: this.formatDimM(h),
      txM: this.round2(Math.min(rect.xM + w - 0.25, xLine + 0.42)),
      tyM: this.round2(rect.yM + h / 2),
      rotate: true,
      tone
    });
  }

  /** CAD xanh lá — kích thước ngang sát mép B (trong zone, dọc tường). */
  private pushCadWidthAlongB(
    out: JwTechDim[],
    id: string,
    rect: { xM: number; yM: number; wM: number; hM: number },
    isJ4: boolean
  ): void {
    const w = this.round2(rect.wM);
    if (w < 0.4) return;
    const pad = Math.min(0.15, w * 0.06);
    const yLine = this.round2(rect.yM + rect.hM - Math.min(0.55, rect.hM * 0.12));
    out.push({
      id,
      isJ4,
      x1M: this.round2(rect.xM + pad),
      y1M: yLine,
      x2M: this.round2(rect.xM + w - pad),
      y2M: yLine,
      label: this.formatDimM(w),
      txM: this.round2(rect.xM + w / 2),
      tyM: this.round2(yLine - 0.38),
      rotate: false,
      tone: 'green'
    });
  }

  /** CAD xanh lá — kích thước sâu sát mép trái (trong zone). */
  private pushCadHeightAlongLeft(
    out: JwTechDim[],
    id: string,
    rect: { xM: number; yM: number; wM: number; hM: number },
    isJ4: boolean
  ): void {
    const h = this.round2(rect.hM);
    if (h < 0.4) return;
    const pad = Math.min(0.15, h * 0.06);
    const xLine = this.round2(rect.xM + Math.min(0.55, rect.wM * 0.12));
    out.push({
      id,
      isJ4,
      x1M: xLine,
      y1M: this.round2(rect.yM + pad),
      x2M: xLine,
      y2M: this.round2(rect.yM + h - pad),
      label: this.formatDimM(h),
      txM: this.round2(xLine + 0.42),
      tyM: this.round2(rect.yM + h / 2),
      rotate: true,
      tone: 'green'
    });
  }

  /** Khoảng cách từ mép phải R286 tới mép trái R296 — lối đi 2.9m sau cặp kệ. */
  private pushR286ToY15Dim(out: JwTechDim[]): void {
    const block = this.r286Block;
    const rack28 = this.racks.find((r) => r.num === 28);
    if (!block || !rack28) return;
    const x1 = this.round2(rack28.xM + rack28.wM);
    const rack29 = this.racks.find((r) => r.num === 29);
    const x2 = rack29
      ? this.round2(rack29.xM)
      : this.round2(this.axisXM(this.RAISED_FROM_AXIS));
    const w = this.round2(x2 - x1);
    if (w < 0.2) return;
    const yLine = this.round2(block.yM + block.hM / 2);
    out.push({
      id: 'gap-r286-r296',
      isJ4: false,
      x1M: x1,
      y1M: yLine,
      x2M: x2,
      y2M: yLine,
      label: this.formatDimM(w),
      txM: this.round2(x1 + w / 2),
      tyM: this.round2(yLine - 0.38),
      rotate: false,
      tone: 'sky'
    });
  }

  /** Khe 0.3m giữa R3|R4 — nhãn ghi ngoài dãy, mũi tên dẫn vào khe tại R31. */
  private pushPairGapDimAtR31(out: JwTechDim[]): void {
    const rack3 = this.racks.find((r) => r.num === 3);
    const b31 = rack3?.blocks.find((b) => b.index === 1);
    const rack4 = this.racks.find((r) => r.num === 4);
    if (!rack3 || !b31 || !rack4) return;
    const left = rack3.xM <= rack4.xM ? rack3 : rack4;
    const right = rack3.xM <= rack4.xM ? rack4 : rack3;
    const wM = this.round2(right.xM - (left.xM + left.wM));
    if (wM < 0.05) return;
    const midX = this.round2(left.xM + left.wM + wM / 2);
    const gapYM = this.round2(b31.yM + b31.hM / 2);
    const labelYM = this.round2(b31.yM + b31.hM + 0.9);
    out.push({
      id: 'aisle-pair-gap-r31',
      isJ4: false,
      x1M: midX,
      y1M: labelYM,
      x2M: midX,
      y2M: gapYM,
      label: this.formatDimM(wM),
      txM: midX,
      tyM: labelYM,
      rotate: false,
      tone: 'sky',
      leader: true
    });
  }

  /** Lối 1.5m giữa block R33 và R34 — mũi tên ngoài dãy kệ. */
  private pushR33R34GapDim(out: JwTechDim[]): void {
    const rack = this.racks.find((r) => r.num === 3);
    if (!rack) return;
    const b4 = rack.blocks.find((b) => b.index === 4);
    const b3 = rack.blocks.find((b) => b.index === 3);
    if (!b4 || !b3) return;
    const startY = this.round2(Math.min(b4.yM + b4.hM, b3.yM + b3.hM));
    const endY = this.round2(Math.max(b4.yM, b3.yM));
    const h = this.round2(endY - startY);
    if (h < 0.4) return;
    const xLine = this.round2(rack.xM - 0.55);
    out.push({
      id: 'gap-r33-r34',
      isJ4: false,
      x1M: xLine,
      y1M: startY,
      x2M: xLine,
      y2M: endY,
      label: this.formatDimM(h),
      txM: this.round2(xLine - 0.42),
      tyM: this.round2(startY + h / 2),
      rotate: true,
      tone: 'sky'
    });
  }

  /** Kệ R1 mẫu — mũi tên rộng/dài nằm NGOÀI dãy kệ (CAD). */
  private pushRackOutsideDims(out: JwTechDim[], rack: JwRack): void {
    this.pushRackWidthDimOutside(out, rack);
    for (const block of rack.blocks) {
      this.pushBlockLengthDimOutside(out, `block-len-${block.code}`, block);
    }
  }

  /** Chiều rộng kệ 1m — ngoài dãy, phía mặt B tại R11. */
  private pushRackWidthDimOutside(out: JwTechDim[], rack: JwRack): void {
    const gap = 0.55;
    if (this.isVerticalRackLayout) {
      const xLine = this.round2(rack.xM - gap);
      const h = this.round2(rack.hM);
      out.push({
        id: `rack-${rack.num}-w`,
        isJ4: false,
        x1M: xLine,
        y1M: rack.yM,
        x2M: xLine,
        y2M: this.round2(rack.yM + h),
        label: this.formatDimM(h),
        txM: this.round2(xLine - 0.42),
        tyM: this.round2(rack.yM + h / 2),
        rotate: true,
        tone: 'sky'
      });
      return;
    }
    const w = this.round2(rack.wM);
    const b11 = rack.blocks.find((b) => b.index === 1);
    const yRef = b11 ? b11.yM + b11.hM : rack.yM + rack.hM;
    const yLine = this.round2(Math.min(this.WIDTH_M - 0.2, yRef + gap));
    out.push({
      id: `rack-${rack.num}-w`,
      isJ4: false,
      x1M: rack.xM,
      y1M: yLine,
      x2M: this.round2(rack.xM + w),
      y2M: yLine,
      label: this.formatDimM(w),
      txM: this.round2(rack.xM + w / 2),
      tyM: this.round2(yLine + 0.7),
      rotate: false,
      tone: 'sky'
    });
  }

  /** Dài mâm kệ — ngoài dãy, phía mặt A. */
  private pushBlockLengthDimOutside(out: JwTechDim[], id: string, block: JwBlock): void {
    const gap = 0.55;
    if (this.isVerticalRackLayout) {
      const w = this.round2(block.wM);
      const yLine = this.round2(block.yM - gap);
      out.push({
        id,
        isJ4: false,
        x1M: block.xM,
        y1M: yLine,
        x2M: this.round2(block.xM + w),
        y2M: yLine,
        label: this.formatDimM(w),
        txM: this.round2(block.xM + w / 2),
        tyM: this.round2(yLine - 0.38),
        rotate: false,
        tone: 'sky'
      });
      return;
    }
    const h = this.round2(block.hM);
    const xLine = this.round2(block.xM - gap);
    out.push({
      id,
      isJ4: false,
      x1M: xLine,
      y1M: this.round2(block.yM + 0.08),
      x2M: xLine,
      y2M: this.round2(block.yM + h - 0.08),
      label: this.formatDimM(h),
      txM: this.round2(xLine - 0.42),
      tyM: this.round2(block.yM + h / 2),
      rotate: true,
      tone: 'sky'
    });
  }

  private techLabelBox(
    txM: number,
    tyM: number,
    label: string,
    rotate: boolean
  ): { x0: number; y0: number; x1: number; y1: number } {
    const charW = 0.38;
    const charH = 0.72;
    const w = Math.max(1.2, label.length * charW);
    const h = charH;
    if (rotate) {
      return {
        x0: txM - h / 2,
        y0: tyM - w / 2,
        x1: txM + h / 2,
        y1: tyM + w / 2
      };
    }
    return {
      x0: txM - w / 2,
      y0: tyM - h / 2,
      x1: txM + w / 2,
      y1: tyM + h / 2
    };
  }

  private boxesOverlap(
    a: { x0: number; y0: number; x1: number; y1: number },
    b: { x0: number; y0: number; x1: number; y1: number }
  ): boolean {
    return !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
  }

  private collectBusyLabelBoxes(isJ4: boolean): Array<{ x0: number; y0: number; x1: number; y1: number }> {
    const boxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    const addRect = (r: { xM: number; yM: number; wM: number; hM: number }, inset = 0.22) => {
      const ix = r.wM * inset;
      const iy = r.hM * inset;
      boxes.push({
        x0: r.xM + ix,
        y0: r.yM + iy,
        x1: r.xM + r.wM - ix,
        y1: r.yM + r.hM - iy
      });
    };
    if (isJ4) {
      for (const z of this.j4FloorZones) addRect(z);
      addRect(this.j4WcMaleZone);
      addRect(this.raisedZone, 0.35);
      return boxes;
    }
    for (const z of this.floorZones) addRect(z);
    addRect(this.j5WcFemaleZone);
    for (const r of this.officeRooms) addRect(r);
    addRect(this.raisedZone, 0.35);
    for (const rack of this.racks.slice(0, 6)) {
      for (const b of rack.blocks) addRect(b, 0.15);
    }
    return boxes;
  }

  private resolveTechDimLabels(dims: JwTechDim[]): JwTechDim[] {
    const placed: JwTechDim[] = [];
    const busyJ5 = this.collectBusyLabelBoxes(false);
    const busyJ4 = this.collectBusyLabelBoxes(true);
    const placedBoxes: Array<{ isJ4: boolean; box: { x0: number; y0: number; x1: number; y1: number } }> = [];

    const hits = (isJ4: boolean, box: { x0: number; y0: number; x1: number; y1: number }): boolean => {
      const busy = isJ4 ? busyJ4 : busyJ5;
      if (busy.some((b) => this.boxesOverlap(box, b))) return true;
      return placedBoxes.some((p) => p.isJ4 === isJ4 && this.boxesOverlap(box, p.box));
    };

    for (const d of dims) {
      const dx = d.x2M - d.x1M;
      const dy = d.y2M - d.y1M;
      const midX = (d.x1M + d.x2M) / 2;
      const midY = (d.y1M + d.y2M) / 2;
      const nx = d.rotate ? (dx === 0 ? 1 : 0) : 0;
      const ny = d.rotate ? 0 : 1;
      const baseOff = d.rotate ? Math.abs(d.txM - midX) || 0.55 : Math.abs(d.tyM - midY) || 0.5;
      const side0 = d.rotate ? Math.sign(d.txM - midX) || 1 : Math.sign(d.tyM - midY) || 1;

      const candidates: Array<{ txM: number; tyM: number }> = [];
      for (const side of [side0, -side0]) {
        for (const t of [0.5, 0.28, 0.72, 0.18, 0.82]) {
          for (const extra of [0, 0.55, 1.1]) {
            const px = d.x1M + dx * t;
            const py = d.y1M + dy * t;
            candidates.push({
              txM: this.round2(px + nx * side * (baseOff + extra)),
              tyM: this.round2(py + ny * side * (baseOff + extra))
            });
          }
        }
      }

      let chosen = { txM: d.txM, tyM: d.tyM };
      let found = false;
      for (const c of candidates) {
        const box = this.techLabelBox(c.txM, c.tyM, d.label, d.rotate);
        if (!hits(d.isJ4, box)) {
          chosen = c;
          found = true;
          break;
        }
      }
      if (!found) {
        chosen = candidates[candidates.length - 1] || chosen;
      }
      const resolved: JwTechDim = { ...d, txM: chosen.txM, tyM: chosen.tyM };
      placed.push(resolved);
      placedBoxes.push({ isJ4: d.isJ4, box: this.techLabelBox(resolved.txM, resolved.tyM, resolved.label, resolved.rotate) });
    }
    return placed;
  }

  /** Trục cạnh B: 7.5 + 15×6 + 7.5 = 105m → Y01…Y18 */
  private buildAxisMarks(): JwAxisMark[] {
    const endSpan = 7.5;
    const midSpan = 6;
    const midSegs = Math.round((this.LENGTH_M - 2 * endSpan) / midSpan);
    const spans: number[] = [endSpan, ...Array.from({ length: midSegs }, () => midSpan), endSpan];
    const marks: JwAxisMark[] = [];
    let x = 0;
    for (let i = 0; i <= spans.length; i++) {
      marks.push({
        id: `Y${String(i + 1).padStart(2, '0')}`,
        index: i + 1,
        xM: Math.round(x * 1000) / 1000,
        spanAfterM: i < spans.length ? spans[i] : null
      });
      if (i < spans.length) x += spans[i];
    }
    return marks;
  }

  private axisXM(id: string): number {
    const hit = this.axisMarks.find((a) => a.id === id);
    return hit?.xM ?? 0;
  }

  private axisYM(id: string): number {
    const hit = this.axisXMarks.find((a) => a.id === id);
    return hit?.yM ?? 0;
  }

  private buildRaisedZone(): { xM: number; yM: number; wM: number; hM: number } {
    const x0 = this.axisXM(this.RAISED_FROM_AXIS);
    const x1 = this.axisXM(this.RAISED_TO_AXIS);
    return {
      xM: x0,
      yM: 0,
      wM: Math.max(0, x1 - x0),
      hM: this.WIDTH_M
    };
  }

  /** Văn phòng sát cạnh B, neo từ Y12 về trái: VP Kho | VP Kho | Kho mát 18.6×7 · IQC tách riêng. */
  private buildOfficeRooms(): JwOfficeRoom[] {
    const yM = this.WIDTH_M - this.OFFICE_H_M;
    const hM = this.OFFICE_H_M;
    const xRightM = this.axisXM(this.OFFICE_ANCHOR_AXIS);

    const vpKho2XM = this.round2(xRightM - this.OFFICE_VPKHO_W_M);
    const vpKho1XM = this.round2(vpKho2XM - this.OFFICE_VPKHO_W_M);
    const securedXM = this.round2(vpKho1XM - this.OFFICE_SECURED_W_M);

    return [
      {
        id: 'iqc',
        label: 'IQC',
        xM: 0,
        yM: this.WIDTH_M - this.OFFICE_IQC_H_M,
        wM: this.OFFICE_IQC_W_M,
        hM: this.OFFICE_IQC_H_M
      },
      {
        id: 'secured',
        label: 'Kho mát',
        labelKey: 'zone.j4ColdStorage',
        xM: securedXM,
        yM,
        wM: this.OFFICE_SECURED_W_M,
        hM
      },
      {
        id: 'vp-kho-1',
        label: 'VP Kho',
        labelKey: 'zone.vpKho',
        xM: vpKho1XM,
        yM,
        wM: this.OFFICE_VPKHO_W_M,
        hM
      },
      {
        id: 'vp-kho-2',
        label: 'VP Kho',
        labelKey: 'zone.vpKho',
        xM: vpKho2XM,
        yM,
        wM: this.OFFICE_VPKHO_W_M,
        hM
      }
    ];
  }

  /** Kho mát mở rộng 10×7m — nét liền, ghi "Kho mát mở rộng", không hatch nền. */
  get khoMatExtZone(): { xM: number; yM: number; wM: number; hM: number } {
    const secured = this.securedOfficeRoom;
    if (!secured) return { xM: 0, yM: 0, wM: 0, hM: 0 };
    return {
      xM: this.round2(secured.xM - this.OFFICE_KHOMAT_EXT_W_M),
      yM: secured.yM,
      wM: this.OFFICE_KHOMAT_EXT_W_M,
      hM: secured.hM
    };
  }

  /** Chỉ bao WH Office + khe + Kho mát (cụm sát Y12) — IQC đứng riêng sát cạnh A nên không tính vào đây. */
  private buildOfficeZone(): { xM: number; yM: number; wM: number; hM: number } {
    const rooms = this.officeRooms.filter((r) => r.id !== 'iqc');
    const xMin = Math.min(...rooms.map((r) => r.xM));
    const xMax = Math.max(...rooms.map((r) => r.xM + r.wM));
    return {
      xM: xMin,
      yM: rooms[0].yM,
      wM: this.round2(xMax - xMin),
      hM: this.OFFICE_H_M
    };
  }

  /**
   * Dãy kệ trong Kho mát — tính từ trái qua phải, đầy hết chiều dài phòng.
   * A01 là dãy đơn, đứng riêng. Từ A02 trở đi, mỗi kệ có 2 mặt nên đi theo cặp sát nhau ngay
   * trên 1 kệ (A02|A03, A04|A05…) — không có khe giữa 2 dãy trong cùng 1 cặp.
   * Khe 0.8m chỉ nằm GIỮA các kệ (đơn/cặp) để chừa lối đi. 3 block trong 1 dãy sát nhau, sát cạnh B.
   */
  private buildKhoMatRows(): JwKhoMatRow[] {
    const room = this.securedOfficeRoom;
    if (!room) return [];

    const blockD = this.KHO_MAT_BLOCK_D_M;
    const wideW = this.KHO_MAT_BLOCK_W_M;
    const narrowW = this.KHO_MAT_BLOCK_W_NARROW_M;
    const gap = this.KHO_MAT_GAP_M;
    const rowDepth = this.round2(this.KHO_MAT_BLOCKS_PER_ROW * blockD);
    const rowYM = this.round2(room.yM + room.hM - rowDepth);
    const roomEndX = this.round2(room.xM + room.wM);

    const rows: JwKhoMatRow[] = [];
    let index = 0;

    const makeRow = (colX: number, colW: number): JwKhoMatRow => {
      index++;
      const rowId = `A${String(index).padStart(2, '0')}`;
      const blocks: JwKhoMatBlock[] = [];
      for (let b = 0; b < this.KHO_MAT_BLOCKS_PER_ROW; b++) {
        blocks.push({
          code: `${rowId}-${b + 1}`,
          xM: colX,
          yM: this.round2(rowYM + b * blockD),
          wM: colW,
          hM: blockD
        });
      }
      return { id: rowId, xM: colX, yM: rowYM, wM: colW, hM: rowDepth, blocks };
    };

    let x = room.xM;
    let isFirstUnit = true;
    while (this.round2(x + (isFirstUnit ? wideW : narrowW)) <= roomEndX) {
      if (isFirstUnit) {
        rows.push(makeRow(x, wideW));
        x = this.round2(x + wideW + gap);
        isFirstUnit = false;
        continue;
      }
      rows.push(makeRow(x, narrowW));
      const secondX = this.round2(x + narrowW);
      if (this.round2(secondX + narrowW) <= roomEndX) {
        rows.push(makeRow(secondX, narrowW));
      }
      x = this.round2(secondX + narrowW + gap);
    }
    return rows;
  }

  trackKhoMatRow(_: number, row: JwKhoMatRow): string {
    return row.id;
  }

  trackKhoMatBlock(_: number, block: JwKhoMatBlock): string {
    return block.code;
  }

  private buildFloorZoneDefs(): Array<
    Omit<JwFloorZone, 'label' | 'labelLines'> & { labelKey: string }
  > {
    const khoMatExt = this.khoMatExtZone;
    const incomingInspectX0 = this.OFFICE_IQC_W_M;
    const incomingInspectWM = khoMatExt.xM - incomingInspectX0;

    /** Cả khu vạch đứt vì không phải vách cứng (trừ phòng liền IQC / VP / Kho mát). */
    return [
      {
        id: 'incoming-inspect',
        labelKey: 'zone.incomingInspect',
        xM: incomingInspectX0,
        yM: khoMatExt.yM,
        wM: this.round2(incomingInspectWM),
        hM: khoMatExt.hM
      },
      {
        /** Kho mát mở rộng 10×7m — nét liền, ghi Kho mát mở rộng, không hatch. */
        id: 'kho-mat-ext',
        labelKey: 'zone.khoMatExt',
        xM: khoMatExt.xM,
        yM: khoMatExt.yM,
        wM: khoMatExt.wM,
        hM: khoMatExt.hM
      },
      {
        /** Nhận nguyên liệu: 6×16m, lùi vào sau WC Nữ (3.5m sát cạnh A) */
        id: 'receiving',
        labelKey: 'zone.receiving',
        xM: 3.5,
        yM: 6,
        wM: 6,
        hM: 16
      },
      {
        /** Sạc xe nâng: Y12 → Y13, sát mặt B */
        id: 'forklift-charging',
        labelKey: 'zone.forkliftCharging',
        xM: this.round2(this.axisXM('Y12')),
        yM: this.round2(this.WIDTH_M - 3),
        wM: this.round2(this.axisXM('Y13') - this.axisXM('Y12')),
        hM: 3
      },
      {
        /** Khu xuất hàng — sát mặt D, thay 1 ô cặp kệ cuối. Bản vẽ gốc không ghi số đo, đây là ước lượng theo tỷ lệ. */
        id: 'shipping-area',
        labelKey: 'zone.shipping',
        xM: this.shippingAreaZone.xM,
        yM: this.shippingAreaZone.yM,
        wM: this.shippingAreaZone.wM,
        hM: this.shippingAreaZone.hM
      }
    ];
  }

  get shippingAreaZone(): { xM: number; yM: number; wM: number; hM: number } {
    const xEnd = this.round2(this.LENGTH_M - this.SHIPPING_AREA_GAP_FROM_D_M);
    return {
      xM: this.round2(xEnd - this.SHIPPING_AREA_W_M),
      yM: this.MARGIN_C_M,
      wM: this.SHIPPING_AREA_W_M,
      hM: this.RACK_LEN_M
    };
  }

  /** Dock Leveler — sát mặt D, gần tủ điện (phía C). */
  readonly DOCK_LEVELER_W_M = 3;
  readonly DOCK_LEVELER_D_M = 1.5;

  get dockLevelers(): Array<{ xM: number; yM: number; wM: number; hM: number }> {
    return [
      {
        xM: this.LENGTH_M,
        yM: this.round2(this.WIDTH_M * 0.28),
        wM: this.DOCK_LEVELER_D_M,
        hM: this.DOCK_LEVELER_W_M
      }
    ];
  }

  trackDockLeveler(i: number): number {
    return i;
  }

  /** WC Nam J4 — viền liền, không có cửa thoát hiểm. */
  get j4WcMaleZone(): JwWcZone {
    return this.buildWcZone('j4-wc-male', 'zone.wcMale', this.buildWcStripJ4Male());
  }

  /** WC Nữ J5 — viền liền, cửa thoát hiểm 1.5m phía trục X21. */
  get j5WcFemaleZone(): JwWcZone {
    return this.buildWcZone('wc-female', 'zone.wcFemale', this.buildWcStripJ5Female(), true);
  }

  /** WC Nam (J4) sát cạnh A: nhịp X20 → X21 (mép B), sâu 3.5m. */
  private buildWcStripJ4Male(): { xM: number; yM: number; wM: number; hM: number } {
    const yX20 = this.axisYM('X25');
    const yX21 = this.axisYM('X26');
    const y0 = Math.min(yX20, yX21);
    const y1 = Math.max(yX20, yX21);
    return {
      xM: 0,
      yM: y0,
      wM: 3.5,
      hM: this.round2(y1 - y0)
    };
  }

  /** WC Nữ (J5) sát cạnh A: giữa X22–X23 → X21, sâu 3.5m. */
  private buildWcStripJ5Female(): { xM: number; yM: number; wM: number; hM: number } {
    const yX21 = this.axisYM('X21');
    const yMidX22X23 = this.round2((this.axisYM('X22') + this.axisYM('X23')) / 2);
    const y0 = Math.min(yX21, yMidX22X23);
    const y1 = Math.max(yX21, yMidX22X23);
    return {
      xM: 0,
      yM: y0,
      wM: 3.5,
      hM: this.round2(y1 - y0)
    };
  }

  wcInnerMidY(wc: JwWcZone): number {
    const exitH = wc.exit?.hM ?? 0;
    return wc.yM + exitH + (wc.hM - exitH) / 2;
  }

  private buildWcZone(
    id: string,
    labelKey: string,
    bounds: { xM: number; yM: number; wM: number; hM: number },
    withExitAtX21 = false
  ): JwWcZone {
    const label = this.t(labelKey);
    const zone: JwWcZone = {
      id,
      label,
      labelLines: this.wrapLabel(label, 7),
      ...bounds
    };
    if (withExitAtX21) {
      zone.exit = {
        xM: bounds.xM,
        yM: bounds.yM,
        wM: bounds.wM,
        hM: this.WC_EXIT_CLEARANCE_M
      };
    }
    return zone;
  }

  /** Bọc nhãn xuống dòng theo từ để nằm gọn trong ô (VD "Khu vực kiểm tra đầu vào"). */
  private wrapLabel(text: string, maxCharsPerLine = 12): string[] {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';
    for (const w of words) {
      const candidate = current ? `${current} ${w}` : w;
      if (candidate.length > maxCharsPerLine && current) {
        lines.push(current);
        current = w;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [text];
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /** Bậc thang lên nền cao — đặt ngay trước mép Y15 (phía A). */
  private buildStairSteps(): Array<{ xM: number; yM: number; wM: number; hM: number }> {
    const edge = this.axisXM(this.RAISED_FROM_AXIS);
    const stepCount = 4;
    const stepDepth = 0.45;
    const stairWidth = 2;
    const stairY0 = (this.WIDTH_M - stairWidth) / 2;
    const steps: Array<{ xM: number; yM: number; wM: number; hM: number }> = [];
    for (let i = 0; i < stepCount; i++) {
      steps.push({
        xM: edge - stepDepth * (stepCount - i),
        yM: stairY0,
        wM: stepDepth,
        hM: stairWidth
      });
    }
    return steps;
  }

  /** Trục cạnh A (C→B): 6.25 + 6.25 + 5 + 6.25 + 6.25 = 30m */
  private buildAxisXMarks(): JwAxisMark[] {
    const spans = [6.25, 6.25, 5, 6.25, 6.25];
    const ids = ['X21', 'X22', 'X23', 'X24', 'X25', 'X26'];
    const marks: JwAxisMark[] = [];
    let y = 0;
    for (let i = 0; i < ids.length; i++) {
      marks.push({
        id: ids[i],
        index: i + 1,
        yM: Math.round(y * 1000) / 1000,
        spanAfterM: i < spans.length ? spans[i] : null
      });
      if (i < spans.length) y += spans[i];
    }
    return marks;
  }

  /**
   * Cửa cuốn vẽ NGOÀI viền kho (không đè mặt bằng):
   * - Cạnh B: Y05–Y06, Y13–Y14
   * - Cạnh A: X23–X24
   * - Cạnh D (Bản vẽ Đăng ký): X23–X24, X24–X25, X25–X26 (J4: X18–X21)
   */
  private buildEdgeFeatures(): JwPlanFeature[] {
    const doorOut = 1.35;
    const list: JwPlanFeature[] = [];

    const rollerBaysB: Array<{ from: string; to: string; id: string }> = [
      { from: 'Y05', to: 'Y06', id: 'roller-y5-y6' },
      { from: 'Y13', to: 'Y14', id: 'roller-y13-y14' }
    ];
    for (const bay of rollerBaysB) {
      const x0 = this.axisXM(bay.from);
      const x1 = this.axisXM(bay.to);
      list.push({
        id: bay.id,
        kind: 'roller',
        edge: 'B',
        xM: x0,
        yM: this.WIDTH_M + 0.2,
        wM: Math.max(0, x1 - x0),
        hM: doorOut,
        label: 'Cửa cuốn',
        subLabel: `${bay.from}–${bay.to}`
      });
    }

    const y0 = this.axisYM('X23');
    const y1 = this.axisYM('X24');
    list.push({
      id: 'roller-x23-x24',
      kind: 'roller',
      edge: 'A',
      xM: -doorOut - 0.2,
      yM: y0,
      wM: doorOut,
      hM: Math.max(0, y1 - y0),
      label: 'Cửa cuốn',
      subLabel: 'X23–X24'
    });

    const rollerBaysD: Array<{ from: string; to: string; j4From: string; j4To: string; id: string }> = [
      { from: 'X23', to: 'X24', j4From: 'X18', j4To: 'X19', id: 'roller-d-x23-x24' },
      { from: 'X24', to: 'X25', j4From: 'X19', j4To: 'X20', id: 'roller-d-x24-x25' },
      { from: 'X25', to: 'X26', j4From: 'X20', j4To: 'X21', id: 'roller-d-x25-x26' }
    ];
    for (const bay of rollerBaysD) {
      const d0 = this.axisYM(bay.from);
      const d1 = this.axisYM(bay.to);
      list.push({
        id: bay.id,
        kind: 'roller',
        edge: 'D',
        xM: this.LENGTH_M + 0.2,
        yM: Math.min(d0, d1),
        wM: doorOut,
        hM: Math.max(0, Math.abs(d1 - d0)),
        label: 'Cửa cuốn',
        subLabel: `${bay.from}–${bay.to}`,
        j4SubLabel: `${bay.j4From}–${bay.j4To}`
      });
    }

    return list;
  }

  private async loadSlotPallets(): Promise<void> {
    try {
      const snap = await this.firestore.collection(this.SLOT_PALLET_COLLECTION).get().toPromise();
      const map = new Map<string, string>();
      (snap?.docs || []).forEach((doc) => {
        const data = doc.data() as { palletCode?: string };
        const code = String(data?.palletCode || '').trim().toUpperCase();
        if (code) map.set(doc.id, code);
      });
      this.slotPallets = map;
      this.lastUpdated = new Date();
    } catch (e) {
      console.error('[JWarehouse] loadSlotPallets failed', e);
    }
  }

  private normalizePalletCode(raw: string): string {
    const t = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!t) return '';
    if (/^\d{4}$/.test(t)) return `P${t}`;
    if (/^P\d{4}$/.test(t)) return t;
    const m = t.match(/P(\d{4})/);
    if (m) return `P${m[1]}`;
    if (/^\d+$/.test(t) && t.length >= 4) return `P${t.slice(-4)}`;
    return t;
  }

  private findSlotByPallet(palletCode: string): string | null {
    const code = palletCode.trim().toUpperCase();
    for (const [slotName, pallet] of this.slotPallets.entries()) {
      if (pallet.trim().toUpperCase() === code) return slotName;
    }
    return null;
  }

  /** Ghi location + palletId lên inventory-materials theo palletId. */
  private async syncInventoryForPallet(palletCode: string, slotCode: string): Promise<number> {
    const code = palletCode.trim().toUpperCase();
    const loc = slotCode.trim().toUpperCase();
    if (!code || !loc) return 0;

    let updated = 0;
    for (const factory of this.SYNC_FACTORIES) {
      try {
        const snap = await this.firestore
          .collection(this.INVENTORY_COLLECTION, (ref) =>
            ref.where('factory', '==', factory).where('palletId', '==', code).limit(50)
          )
          .get()
          .toPromise();

        for (const doc of snap?.docs || []) {
          const data = doc.data() as {
            materialCode?: string;
            poNumber?: string;
            location?: string;
            viTri?: string;
          };
          const fromLocation = String(data.location || data.viTri || '').trim();
          await this.firestore.collection(this.INVENTORY_COLLECTION).doc(doc.id).update({
            location: loc,
            palletId: code,
            updatedAt: new Date(),
            lastModified: new Date(),
            modifiedBy: 'j-warehouse',
            locationManualOverride: true
          });
          await this.firestore.collection(this.LOCATION_HISTORY_COLLECTION).add({
            factory,
            materialId: doc.id,
            materialCode: data.materialCode || '',
            poNumber: data.poNumber || '',
            fromLocation,
            toLocation: loc,
            palletId: code,
            changedBy: 'j-warehouse',
            changeType: 'j-warehouse-map',
            changedAt: new Date()
          });
          updated++;
        }
      } catch (err) {
        console.error('[JWarehouse] syncInventoryForPallet failed', factory, err);
      }
    }
    return updated;
  }

  private buildRacks(): JwRack[] {
    return this.rackLayout === 'vertical' ? this.buildRacksVertical() : this.buildRacksHorizontal();
  }

  private buildRacksHorizontal(): JwRack[] {
    const list: JwRack[] = [];
    let pairIndex = 0;
    let rackNum = 1;
    const raisedX0 = this.axisXM(this.RAISED_FROM_AXIS);
    const startX = this.RACK_START_M;

    while (true) {
      const pairStartX = startX + pairIndex * this.PAIR_PITCH_M;
      if (pairStartX + this.PAIR_DEPTH_M > this.LENGTH_M) break;
      if (pairStartX + this.PAIR_DEPTH_M > raisedX0) break;
      if (rackNum > this.MAX_RACK_NUM) break;

      for (let side = 0; side < 2; side++) {
        if (rackNum > this.MAX_RACK_NUM) break;
        const xM = pairStartX + side * (this.RACK_DEPTH_M + this.RACK_GAP_M);
        if (xM + this.RACK_DEPTH_M > raisedX0) break;

        const blocks = this.buildHorizontalRackBlocks(rackNum, xM);

        list.push({
          id: `R${rackNum}`,
          num: rackNum,
          pairIndex,
          isInner: side === 0,
          xM,
          yM: this.MARGIN_C_M,
          wM: this.RACK_DEPTH_M,
          hM: this.RACK_LEN_M,
          blocks
        });
        rackNum++;
      }

      pairIndex++;
    }

    this.appendRack29AtY15(list, pairIndex);
    return list;
  }

  /**
   * Dãy R29 — chỉ block R294, R295, R296 (phía C).
   * Đặt sau R28 đúng lối đi 2.9m (không neo sát Y15 — tránh khe dư 2.6m).
   */
  private appendRack29AtY15(list: JwRack[], pairIndex: number): void {
    if (list.some((r) => r.num === 29)) return;
    const last = list.find((r) => r.num === 28) || (list.length ? list[list.length - 1] : null);
    if (!last) return;
    const xM = this.round2(last.xM + last.wM + this.AISLE_M);
    const raisedX0 = this.axisXM(this.RAISED_FROM_AXIS);
    if (xM >= raisedX0) return;

    const blocks = this.buildHorizontalRackBlocksCSideOnly(29, xM);
    if (!blocks.length) return;
    const yMin = Math.min(...blocks.map((b) => b.yM));
    const yMax = Math.max(...blocks.map((b) => b.yM + b.hM));

    list.push({
      id: 'R29',
      num: 29,
      pairIndex,
      isInner: true,
      xM,
      yM: yMin,
      wM: this.RACK_DEPTH_M,
      hM: this.round2(yMax - yMin),
      blocks
    });
  }

  /** Chỉ nhóm block 6–5–4 (phía C) — dùng cho R29 sát Y15. */
  private buildHorizontalRackBlocksCSideOnly(rackNum: number, xM: number): JwBlock[] {
    const blocks: JwBlock[] = [];
    let yCursor = this.round2(this.MARGIN_C_M + this.UPRIGHT_M);
    const group = [6, 5, 4];
    for (let i = 0; i < group.length; i++) {
      const blockIndex = group[i];
      const hM = this.blockLenM(blockIndex);
      blocks.push({
        code: this.blockCode(rackNum, blockIndex),
        rackNum,
        index: blockIndex,
        xM,
        yM: yCursor,
        wM: this.RACK_DEPTH_M,
        hM
      });
      yCursor = this.round2(yCursor + hM);
      if (i < group.length - 1) {
        yCursor = this.round2(yCursor + this.UPRIGHT_M);
      }
    }
    return blocks.sort((a, b) => a.index - b.index);
  }

  /** Block 6–5–4 (phía C), lối 1.5m, block 3–2–1 (phía B). */
  private buildHorizontalRackBlocks(rackNum: number, xM: number): JwBlock[] {
    const blocks: JwBlock[] = [];
    let yCursor = this.round2(this.MARGIN_C_M + this.UPRIGHT_M);

    const upperGroup = [6, 5, 4];
    for (let i = 0; i < upperGroup.length; i++) {
      const blockIndex = upperGroup[i];
      const hM = this.blockLenM(blockIndex);
      blocks.push({
        code: this.blockCode(rackNum, blockIndex),
        rackNum,
        index: blockIndex,
        xM,
        yM: yCursor,
        wM: this.RACK_DEPTH_M,
        hM
      });
      yCursor = this.round2(yCursor + hM);
      if (i < upperGroup.length - 1) {
        yCursor = this.round2(yCursor + this.UPRIGHT_M);
      }
    }

    yCursor = this.round2(yCursor + this.BLOCK_GROUP_GAP_M);

    const lowerGroup = [3, 2, 1];
    for (let i = 0; i < lowerGroup.length; i++) {
      const blockIndex = lowerGroup[i];
      const hM = this.blockLenM(blockIndex);
      blocks.push({
        code: this.blockCode(rackNum, blockIndex),
        rackNum,
        index: blockIndex,
        xM,
        yM: yCursor,
        wM: this.RACK_DEPTH_M,
        hM
      });
      yCursor = this.round2(yCursor + hM);
      if (i < lowerGroup.length - 1) {
        yCursor = this.round2(yCursor + this.UPRIGHT_M);
      }
    }

    blocks.sort((a, b) => a.index - b.index);
    return blocks;
  }

  /** Xếp dọc: cặp kệ theo Y (C→B), thân kệ chạy theo X (A→D); lặp cột khi hết chỗ theo Y. */
  private buildRacksVertical(): JwRack[] {
    const list: JwRack[] = [];
    let rackNum = 1;

    const raisedX0 = this.axisXM(this.RAISED_FROM_AXIS);
    const officeY0 = this.WIDTH_M - this.OFFICE_H_M; // mép gần "Secured/Office" (phía mặt B)
    const securedGapM = 2.5;
    const yLimitM = this.round2(officeY0 - securedGapM);

    const marginC = this.MARGIN_C_VERTICAL_M; // sát mặt C
    const startX = this.RACK_START_M;
    const colPitchM = this.round2(this.RACK_LEN_VERTICAL_M + this.AISLE_M);

    let colX = startX;
    while (rackNum <= this.MAX_RACK_NUM) {
      if (colX + this.RACK_LEN_VERTICAL_M > raisedX0 + 0.001) break;

      // Chuỗi y theo mặt C -> B: 1 kệ đơn, sau đó các cặp kệ.
      let nextPairStartY = this.round2(marginC + this.RACK_DEPTH_M + this.AISLE_M);

      // 1) Kệ đơn sát mặt C
      if (marginC + this.RACK_DEPTH_M <= yLimitM + 0.001 && rackNum <= this.MAX_RACK_NUM) {
        const reversed = rackNum >= 11 && rackNum <= 16;
        list.push(
          this.makeVerticalRack(rackNum, colX, marginC, -1, false, reversed, this.RACK_LEN_VERTICAL_M)
        );
        rackNum++;
      }

      // 2) Các cặp kệ
      let pairIndex = 0;
      while (rackNum <= this.MAX_RACK_NUM) {
        // side0 nằm ở nextPairStartY; side1 cách nhau (depth + gap)
        const y0 = nextPairStartY;
        const y1 = this.round2(nextPairStartY + this.RACK_DEPTH_M + this.RACK_GAP_VERTICAL_M);

        if (y0 + this.RACK_DEPTH_M > yLimitM + 0.001) break;
        if (y1 + this.RACK_DEPTH_M > yLimitM + 0.001) break;

        for (let side = 0; side < 2; side++) {
          const yM = side === 0 ? y0 : y1;
          const reversed = rackNum >= 11 && rackNum <= 16;
          list.push(
            this.makeVerticalRack(rackNum, colX, yM, pairIndex, side === 0, reversed, this.RACK_LEN_VERTICAL_M)
          );
          rackNum++;
        }

        pairIndex++;
        nextPairStartY = this.round2(nextPairStartY + this.PAIR_PITCH_M);
      }

      colX = this.round2(colX + colPitchM);
    }

    // Thêm 1 dãy kệ đơn:
    // khoảng cách theo trục Y giữa dãy R7, R14, R21 và "kệ đơn mới"
    // là 2.5m. Trong cấu trúc hiện tại, để tạo thêm dãy đơn mà không đổi
    // số lượng kệ, ta dời "kệ đối" (rackNum - 1) ra xa theo Y.
    const extraSingleGapFromM = 2.5;
    const refNums = [7, 14, 21];
    const yMin = marginC;
    const yMax = this.round2(yLimitM - this.RACK_DEPTH_M);

    for (const refNum of refNums) {
      const refRack = list.find((r) => r.num === refNum);
      const partnerRack = list.find((r) => r.num === refNum - 1);
      if (!refRack || !partnerRack) continue;

      const yNew = this.round2(refRack.yM + extraSingleGapFromM);
      if (yNew < yMin - 0.001 || yNew > yMax + 0.001) continue;

      partnerRack.yM = yNew;
      for (const b of partnerRack.blocks) {
        b.yM = yNew;
      }
    }

    return list;
  }

  /** Block dãy kệ xếp dọc — `reversed`: R11 sát A, R16 sát D (dãy R1 gần mặt B). */
  private buildVerticalRackBlocks(
    rackNum: number,
    colX: number,
    yM: number,
    reversed: boolean
  ): JwBlock[] {
    const blocks: JwBlock[] = [];
    const wM = this.BLOCK_LEN_M; // Xếp dọc: tất cả block đều 3.3m
    const rackLenV = this.RACK_LEN_VERTICAL_M;

    if (!reversed) {
      let xCursor = this.round2(colX + this.UPRIGHT_M);
      for (let blockIndex = this.BLOCKS_PER_RACK; blockIndex >= 1; blockIndex--) {
        blocks.push({
          code: this.blockCode(rackNum, blockIndex),
          rackNum,
          index: blockIndex,
          xM: xCursor,
          yM,
          wM,
          hM: this.RACK_DEPTH_M
        });
        xCursor = this.round2(xCursor + wM + this.UPRIGHT_M);
      }
    } else {
      let xCursor = this.round2(colX + rackLenV - this.UPRIGHT_M);
      for (let blockIndex = 1; blockIndex <= this.BLOCKS_PER_RACK; blockIndex++) {
        xCursor = this.round2(xCursor - wM);
        blocks.push({
          code: this.blockCode(rackNum, blockIndex),
          rackNum,
          index: blockIndex,
          xM: xCursor,
          yM,
          wM,
          hM: this.RACK_DEPTH_M
        });
        xCursor = this.round2(xCursor - this.UPRIGHT_M);
      }
    }
    blocks.sort((a, b) => a.index - b.index);
    return blocks;
  }

  private makeVerticalRack(
    rackNum: number,
    colX: number,
    yM: number,
    pairIndex: number,
    isInner: boolean,
    reversed: boolean,
    rackLenM: number
  ): JwRack {
    return {
      id: `R${rackNum}`,
      num: rackNum,
      pairIndex,
      isInner,
      xM: colX,
      yM,
      wM: rackLenM,
      hM: this.RACK_DEPTH_M,
      blocks: this.buildVerticalRackBlocks(rackNum, colX, yM, reversed)
    };
  }

  private buildAisles(): JwAisleRect[] {
    return this.rackLayout === 'vertical' ? this.buildAislesVertical() : this.buildAislesHorizontal();
  }

  private buildAislesHorizontal(): JwAisleRect[] {
    const aisles: JwAisleRect[] = [];
    const pairs = Math.floor(this.racks.length / 2);
    const startX = this.RACK_START_M;
    for (let i = 0; i < pairs - 1; i++) {
      aisles.push({
        xM: startX + i * this.PAIR_PITCH_M + this.PAIR_DEPTH_M,
        yM: this.MARGIN_C_M,
        wM: this.AISLE_M,
        hM: this.RACK_LEN_M,
        label: `${this.AISLE_M}m`
      });
    }
    return aisles;
  }

  private buildAislesVertical(): JwAisleRect[] {
    const aisles: JwAisleRect[] = [];
    if (!this.racks.length) return aisles;

    const cols = new Map<number, JwRack[]>();
    for (const rack of this.racks) {
      const key = this.round2(rack.xM);
      const group = cols.get(key) || [];
      group.push(rack);
      cols.set(key, group);
    }

    const colXs = Array.from(cols.keys()).sort((a, b) => a - b);
    for (let i = 0; i < colXs.length - 1; i++) {
      const group = cols.get(colXs[i])!;
      const y0 = Math.min(...group.map((r) => r.yM));
      const y1 = Math.max(...group.map((r) => r.yM + r.hM));
      const xEdge = Math.max(...group.map((r) => r.xM + r.wM));
      aisles.push({
        xM: this.round2(xEdge),
        yM: this.round2(y0),
        wM: this.AISLE_M,
        hM: this.round2(y1 - y0),
        label: `${this.AISLE_M}m`
      });
    }
    return aisles;
  }

  private buildPairGaps(): JwPairGapRect[] {
    return this.rackLayout === 'vertical' ? this.buildPairGapsVertical() : this.buildPairGapsHorizontal();
  }

  private buildBlockGroupGaps(): JwPairGapRect[] {
    if (this.rackLayout === 'vertical') return [];
    const gaps: JwPairGapRect[] = [];
    for (const rack of this.racks) {
      const b4 = rack.blocks.find((b) => b.index === 4);
      const b3 = rack.blocks.find((b) => b.index === 3);
      if (!b4 || !b3) continue;
      gaps.push({
        xM: rack.xM,
        yM: this.round2(b4.yM + b4.hM),
        wM: rack.wM,
        hM: this.round2(b3.yM - (b4.yM + b4.hM))
      });
    }
    return gaps;
  }

  private buildPairGapsHorizontal(): JwPairGapRect[] {
    const gaps: JwPairGapRect[] = [];
    const pairs = Math.floor(this.racks.length / 2);
    const startX = this.RACK_START_M;
    for (let i = 0; i < pairs; i++) {
      gaps.push({
        xM: startX + i * this.PAIR_PITCH_M + this.RACK_DEPTH_M,
        yM: this.MARGIN_C_M,
        wM: this.RACK_GAP_M,
        hM: this.RACK_LEN_M
      });
    }
    return gaps;
  }

  private buildPairGapsVertical(): JwPairGapRect[] {
    const gaps: JwPairGapRect[] = [];
    const cols = new Map<number, JwRack[]>();
    for (const rack of this.racks) {
      const key = this.round2(rack.xM);
      const group = cols.get(key) || [];
      group.push(rack);
      cols.set(key, group);
    }

    for (const group of cols.values()) {
      const byPair = new Map<number, JwRack[]>();
      for (const rack of group) {
        const pairGroup = byPair.get(rack.pairIndex) || [];
        pairGroup.push(rack);
        byPair.set(rack.pairIndex, pairGroup);
      }
      for (const pairRacks of byPair.values()) {
        if (pairRacks.length < 2) continue;
        const sorted = pairRacks.sort((a, b) => a.yM - b.yM);
        const inner = sorted[0];
        gaps.push({
          xM: inner.xM,
          yM: this.round2(inner.yM + inner.hM),
          wM: this.RACK_LEN_M,
          hM: this.RACK_GAP_VERTICAL_M
        });
      }
    }
    return gaps;
  }
}
