/** Cấu hình & phân bổ sơ đồ kệ lưu trữ TP (Thống Kê TP theo thùng). */

export interface StoragePalletSlot {
  /** vd. A1.1A */
  label: string;
  /** 1|2|3 tương ứng A|B|C trên mâm */
  palletNo: number;
  /** Chữ vị trí trên mâm: A / B / C */
  slotLetter: string;
  carton: number;
  capacityCarton: number;
  utilizationPct: number;
}

export interface StorageLevelSlot {
  label: string;
  rackId: string;
  level: number;
  customer: string;
  carton: number;
  capacityCarton: number;
  utilizationPct: number;
  /** Mỗi mâm 3 vị trí: A1.1A … A1.1C */
  pallets: StoragePalletSlot[];
  cartonPerPallet: number;
}

export interface StorageRackView {
  id: string;
  zone: 'A' | 'B' | 'C';
  zoneTitle: string;
  levels: StorageLevelSlot[];
  primaryCustomer: string;
  totalCarton: number;
  capacityCarton: number;
  utilizationPct: number;
}

export interface StorageZoneView {
  key: string;
  title: string;
  subtitle: string;
  racks: StorageRackView[];
}

const LEVELS_PER_RACK = 5;
const PALLETS_PER_LEVEL = 3;
/** Mặc định (khu A và tầng thường): 18 carton / pallet */
const MAX_CARTON_PER_PALLET = 18;
/** Tầng 1 dãy B1–B9, C1–C6 */
const MAX_CARTON_PER_PALLET_BC_L1 = 42;
/** Tầng 2 dãy B1–B9, C1–C6 */
const MAX_CARTON_PER_PALLET_BC_L2 = 3;
const MAX_LOT_PER_PALLET = 3;

export const LEVEL_CAPACITY_CARTON = PALLETS_PER_LEVEL * MAX_CARTON_PER_PALLET;
export const RACK_CAPACITY_CARTON = LEVELS_PER_RACK * LEVEL_CAPACITY_CARTON;

/** Sức chứa 1 pallet theo kệ + tầng. */
export function getCartonPerPallet(rackId: string, level: number): number {
  const id = String(rackId || '').trim().toUpperCase();
  const lv = Number(level) || 0;
  const isBcSpecial = /^B[1-9]$/.test(id) || /^C[1-6]$/.test(id);
  if (isBcSpecial) {
    if (lv === 1) return MAX_CARTON_PER_PALLET_BC_L1;
    if (lv === 2) return MAX_CARTON_PER_PALLET_BC_L2;
  }
  return MAX_CARTON_PER_PALLET;
}

export function getLevelCapacityCarton(rackId: string, level: number): number {
  return PALLETS_PER_LEVEL * getCartonPerPallet(rackId, level);
}

/** PL1→A, PL2→B, PL3→C */
export function palletNoToLetter(palletNo: number): string {
  const n = Number(palletNo) || 0;
  if (n === 1) return 'A';
  if (n === 2) return 'B';
  if (n === 3) return 'C';
  return '';
}

export function palletLetterToNo(letter: string): number {
  const L = String(letter || '').trim().toUpperCase();
  if (L === 'A' || L === '1') return 1;
  if (L === 'B' || L === '2') return 2;
  if (L === 'C' || L === '3') return 3;
  return 0;
}

/** Nhãn ô trên mâm: C1.4A (không còn -PL1). */
export function buildPalletLabel(levelLabel: string, palletNo: number): string {
  const letter = palletNoToLetter(palletNo);
  return letter ? `${levelLabel}${letter}` : levelLabel;
}

/**
 * Ghép vị trí kệ + mã QR pallet.
 * vd. slot=C1.4A, qr=F1-111 → C1.4A-F1-111
 */
export function composeStorageLocation(shelfSlot: string, palletQrCode: string): string {
  const slot = normalizeStorageLocation(shelfSlot).replace(/-+$/, '');
  const qr = normalizePalletQrCode(palletQrCode);
  if (!slot) return qr;
  if (!qr) return slot;
  if (slot.endsWith(`-${qr}`) || slot.endsWith(qr)) return slot;
  // Temp không ghép mã pallet
  if (/^TEMP-[123]$/i.test(slot) || slot === 'TEMPORARY') return slot;
  return `${slot}-${qr}`;
}

/** Chuẩn hóa mã QR pallet (giữ dấu -, bỏ khoảng trắng). */
export function normalizePalletQrCode(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9.\-_+]/g, '');
}

/** Tách mã QR pallet ở cuối vị trí đầy đủ (C1.4A-F1-111 → F1-111). */
export function extractPalletQrCode(location: string): string {
  const raw = normalizeStorageLocation(location);
  if (!raw) return '';
  // Legacy: C1.4-PL1-F1-111
  let m = raw.match(/^[ABC]\d+\.\d+(?:[-_]?PL\d+|[ABC])-(.+)$/i);
  if (m) return normalizePalletQrCode(m[1]);
  // Slot chữ + QR: C1.4A-F1-111
  m = raw.match(/^[ABC]\d+\.\d+[ABC]-(.+)$/i);
  if (m) return normalizePalletQrCode(m[1]);
  // Nếu chuỗi không phải slot kệ → coi cả chuỗi là mã pallet
  if (!/^[ABC]\d+/i.test(raw) && !/^TEMP/i.test(raw)) {
    return normalizePalletQrCode(raw);
  }
  return '';
}

/** Chỉ phần kệ/tầng/ô (C1.4A), bỏ mã pallet phía sau. */
export function extractShelfSlot(location: string): string {
  const parsed = parseStorageSlotLocation(location);
  if (parsed?.palletLabel) return parsed.palletLabel;
  if (parsed?.label) return parsed.label;
  const raw = normalizeStorageLocation(location);
  if (/^TEMP-[123]$/i.test(raw) || raw === 'TEMPORARY') return raw;
  return raw;
}

/** Khách khu A — kệ A1..A4 + phần còn lại A5/A6 */
export const ZONE_A_PRIMARY_CUSTOMERS = [
  'FJXR', 'MACHI', 'TETRO', 'SETRA', 'MCURY', 'LEXMK', 'LVT', 'ISCIE', 'TTRAC'
] as const;

/** 6 mâm dư trên A5/A6 — mỗi khách 1 mâm cố định */
export const ZONE_A_RESERVED_CUSTOMERS = [
  'OST', 'SPT', 'TOA', 'BTUNG', 'AVERY', 'ADAM'
] as const;

export const ZONE_A_CUSTOMERS = [
  ...ZONE_A_PRIMARY_CUSTOMERS,
  ...ZONE_A_RESERVED_CUSTOMERS
] as const;

/** Gán cố định: A5.1–A5.5 + A6.1 */
export const ZONE_A_RESERVED_SLOTS: ReadonlyArray<{
  rackId: string;
  level: number;
  label: string;
  customerCode: string;
}> = [
  { rackId: 'A5', level: 1, label: 'A5.1', customerCode: 'OST' },
  { rackId: 'A5', level: 2, label: 'A5.2', customerCode: 'SPT' },
  { rackId: 'A5', level: 3, label: 'A5.3', customerCode: 'TOA' },
  { rackId: 'A5', level: 4, label: 'A5.4', customerCode: 'BTUNG' },
  { rackId: 'A5', level: 5, label: 'A5.5', customerCode: 'AVERY' },
  { rackId: 'A6', level: 1, label: 'A6.1', customerCode: 'ADAM' }
];

/** Mâm để trống (sample) — không phân bổ khách mass */
export const ZONE_A_SAMPLE_SLOTS: ReadonlyArray<{
  rackId: string;
  level: number;
  label: string;
  displayLabel: string;
}> = [
  { rackId: 'A1', level: 2, label: 'A1.2', displayLabel: 'SAMPLE' }
];

/** Kệ B1..B6 */
export const ZONE_B_GIL_HOB_CUSTOMERS = ['GIL', 'HOB'] as const;

/** Kệ B7..B9, C7..C9 */
export const ZONE_SCIEN_CUSTOMERS = ['SCIEN'] as const;

/** Kệ C1..C6 */
export const ZONE_AXON_CUSTOMERS = ['AXON'] as const;

interface RackDef {
  id: string;
  zone: 'A' | 'B' | 'C';
  zoneTitle: string;
  subtitle: string;
}

function rackIds(prefix: string, from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);
}

const RACK_DEFS: RackDef[] = [
  ...rackIds('A', 1, 6).map((id) => ({
    id,
    zone: 'A' as const,
    zoneTitle: 'Khu A',
    subtitle: ZONE_A_CUSTOMERS.join(', ')
  })),
  ...rackIds('B', 1, 6).map((id) => ({
    id,
    zone: 'B' as const,
    zoneTitle: 'Khu B (GIL / HOB)',
    subtitle: 'GIL, HOB'
  })),
  ...rackIds('B', 7, 9).map((id) => ({
    id,
    zone: 'B' as const,
    zoneTitle: 'Khu B (Scien)',
    subtitle: 'Scien'
  })),
  ...rackIds('C', 1, 6).map((id) => ({
    id,
    zone: 'C' as const,
    zoneTitle: 'Khu C (Axon)',
    subtitle: 'Axon'
  })),
  ...rackIds('C', 7, 9).map((id) => ({
    id,
    zone: 'C' as const,
    zoneTitle: 'Khu C (Scien)',
    subtitle: 'Scien'
  }))
];

function norm(s: string): string {
  return String(s || '').trim().toUpperCase();
}

/** Khớp tên khách trong danh mục với mã khu (FJXR, GIL, …). */
export function matchesStorageCustomer(customerName: string, zoneCode: string): boolean {
  const c = norm(customerName);
  const z = norm(zoneCode);
  if (!c || !z) return false;
  if (c === z) return true;
  if (c.includes(z) || z.includes(c)) return true;
  const cTok = c.replace(/[^A-Z0-9]/g, '');
  const zTok = z.replace(/[^A-Z0-9]/g, '');
  return cTok === zTok || cTok.includes(zTok) || zTok.includes(cTok);
}

function customerBelongsToRack(customer: string, rack: RackDef): boolean {
  const codes =
    rack.id.startsWith('A')
      ? ZONE_A_CUSTOMERS
      : rack.id >= 'B1' && rack.id <= 'B6'
        ? ZONE_B_GIL_HOB_CUSTOMERS
        : rack.id >= 'B7' && rack.id <= 'B9'
          ? ZONE_SCIEN_CUSTOMERS
          : rack.id >= 'C1' && rack.id <= 'C6'
            ? ZONE_AXON_CUSTOMERS
            : ZONE_SCIEN_CUSTOMERS;
  return (codes as readonly string[]).some((code) => matchesStorageCustomer(customer, code));
}

function racksForZone(zoneKey: string): RackDef[] {
  if (zoneKey === 'A') return RACK_DEFS.filter((r) => r.zone === 'A');
  if (zoneKey === 'B-GIL') return RACK_DEFS.filter((r) => r.id >= 'B1' && r.id <= 'B6');
  if (zoneKey === 'B-SCIEN') return RACK_DEFS.filter((r) => r.id >= 'B7' && r.id <= 'B9');
  if (zoneKey === 'C-AXON') return RACK_DEFS.filter((r) => r.id >= 'C1' && r.id <= 'C6');
  if (zoneKey === 'C-SCIEN') return RACK_DEFS.filter((r) => r.id >= 'C7' && r.id <= 'C9');
  return [];
}

function emptyPallets(levelLabel: string, cartonPerPallet: number): StoragePalletSlot[] {
  return Array.from({ length: PALLETS_PER_LEVEL }, (_, i) => {
    const palletNo = i + 1;
    return {
      label: buildPalletLabel(levelLabel, palletNo),
      palletNo,
      slotLetter: palletNoToLetter(palletNo),
      carton: 0,
      capacityCarton: cartonPerPallet,
      utilizationPct: 0
    };
  });
}

function emptyLevel(rackId: string, level: number): StorageLevelSlot {
  const label = `${rackId}.${level}`;
  const cartonPerPallet = getCartonPerPallet(rackId, level);
  const capacityCarton = PALLETS_PER_LEVEL * cartonPerPallet;
  return {
    label,
    rackId,
    level,
    customer: '',
    carton: 0,
    capacityCarton,
    utilizationPct: 0,
    pallets: emptyPallets(label, cartonPerPallet),
    cartonPerPallet
  };
}

/** Đổ carton vào 3 vị trí của mâm (A → C), cập nhật tổng mâm. */
function fillLevelCartons(slot: StorageLevelSlot, totalCarton: number): void {
  let remaining = Math.max(0, Number(totalCarton) || 0);
  for (const p of slot.pallets) {
    const put = Math.min(remaining, p.capacityCarton);
    p.carton = put;
    p.utilizationPct = p.capacityCarton > 0 ? Math.min(100, Math.round((put / p.capacityCarton) * 100)) : 0;
    remaining -= put;
  }
  slot.carton = slot.pallets.reduce((s, p) => s + p.carton, 0);
  slot.utilizationPct =
    slot.capacityCarton > 0 ? Math.min(100, Math.round((slot.carton / slot.capacityCarton) * 100)) : 0;
}

function buildRackView(rack: RackDef, levels: StorageLevelSlot[]): StorageRackView {
  const rackLevels = levels.filter((l) => l.rackId === rack.id).sort((a, b) => b.level - a.level);
  const totalCarton = rackLevels.reduce((s, l) => s + l.carton, 0);
  const capacityCarton = rackLevels.reduce((s, l) => s + l.capacityCarton, 0);
  const primary = rackLevels.find((l) => l.customer)?.customer || '—';
  return {
    id: rack.id,
    zone: rack.zone,
    zoneTitle: rack.zoneTitle,
    levels: rackLevels,
    primaryCustomer: primary,
    totalCarton,
    capacityCarton,
    utilizationPct: capacityCarton > 0 ? Math.min(100, Math.round((totalCarton / capacityCarton) * 100)) : 0
  };
}

function getReservedCodeForSlot(rackId: string, level: number): string | null {
  return ZONE_A_RESERVED_SLOTS.find((s) => s.rackId === rackId && s.level === level)?.customerCode ?? null;
}

export function isReservedStorageSlot(label: string): boolean {
  return ZONE_A_RESERVED_SLOTS.some((s) => s.label === label);
}

export function isSampleStorageSlot(label: string): boolean {
  const key = String(label || '').trim().toUpperCase();
  return ZONE_A_SAMPLE_SLOTS.some((s) => s.label === key || key.startsWith(s.label));
}

function getSampleDisplayForSlot(rackId: string, level: number): string | null {
  return ZONE_A_SAMPLE_SLOTS.find((s) => s.rackId === rackId && s.level === level)?.displayLabel ?? null;
}

function isReservedZoneACustomer(customer: string): boolean {
  return (ZONE_A_RESERVED_CUSTOMERS as readonly string[]).some((code) =>
    matchesStorageCustomer(customer, code)
  );
}

function isPrimaryZoneACustomer(customer: string): boolean {
  return (ZONE_A_PRIMARY_CUSTOMERS as readonly string[]).some((code) =>
    matchesStorageCustomer(customer, code)
  );
}

/** Khách được phép ở mâm (tầng) cụ thể — khu A có mâm cố định A5/A6; A1.2 dành sample. */
export function isCustomerAllowedOnSlot(customer: string, rackId: string, level: number): boolean {
  if (getSampleDisplayForSlot(rackId, level)) {
    // Sample slot — không gán khách mass; cho phép rỗng / SAMPLE
    const c = String(customer || '').trim().toUpperCase();
    return !c || c === 'SAMPLE' || c.includes('SAMPLE');
  }
  const reservedCode = getReservedCodeForSlot(rackId, level);
  if (reservedCode) {
    return matchesStorageCustomer(customer, reservedCode);
  }
  if (!rackId.startsWith('A')) {
    return isCustomerAllowedOnRack(customer, rackId);
  }
  // Khách dự trữ chỉ được ở mâm cố định
  if (isReservedZoneACustomer(customer)) return false;
  return isPrimaryZoneACustomer(customer) || isCustomerAllowedOnRack(customer, rackId);
}

/**
 * Khu A: 6 mâm cố định A5/A6 cho OST…ADAM; A1.2 để trống (sample);
 * khách chính xếp các mâm còn lại.
 */
function allocateZoneA(
  rackDefs: RackDef[],
  customerCartons: Map<string, number>
): StorageRackView[] {
  const levels: StorageLevelSlot[] = [];
  const reservedLabels = new Set(ZONE_A_RESERVED_SLOTS.map((s) => s.label));
  const sampleLabels = new Set(ZONE_A_SAMPLE_SLOTS.map((s) => s.label));

  for (const rack of rackDefs) {
    for (let lv = 1; lv <= LEVELS_PER_RACK; lv++) {
      levels.push(emptyLevel(rack.id, lv));
    }
  }

  // A1.2 — để trống cho sample
  for (const sample of ZONE_A_SAMPLE_SLOTS) {
    const slot = levels.find((l) => l.rackId === sample.rackId && l.level === sample.level);
    if (!slot) continue;
    slot.customer = sample.displayLabel;
    fillLevelCartons(slot, 0);
  }

  const reservedNames = new Set<string>();

  for (const slotDef of ZONE_A_RESERVED_SLOTS) {
    const slot = levels.find((l) => l.rackId === slotDef.rackId && l.level === slotDef.level);
    if (!slot) continue;

    let customerName = '';
    let totalCarton = 0;
    customerCartons.forEach((carton, name) => {
      if (matchesStorageCustomer(name, slotDef.customerCode)) {
        customerName = name;
        totalCarton = carton;
      }
    });

    slot.customer = customerName || slotDef.customerCode;
    if (customerName) {
      reservedNames.add(customerName);
      fillLevelCartons(slot, Math.min(totalCarton, slot.capacityCarton));
    }
  }

  const otherCustomers = [...customerCartons.entries()]
    .filter(([name, carton]) => carton > 0 && !reservedNames.has(name))
    .filter(([name]) => isPrimaryZoneACustomer(name))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi'));

  let levelIdx = 0;
  for (const [customer, totalCarton] of otherCustomers) {
    let remaining = totalCarton;
    while (remaining > 0 && levelIdx < levels.length) {
      const slot = levels[levelIdx];
      if (reservedLabels.has(slot.label) || sampleLabels.has(slot.label)) {
        levelIdx += 1;
        continue;
      }
      if (slot.customer && slot.customer !== customer) {
        levelIdx += 1;
        continue;
      }
      slot.customer = customer;
      const free = slot.capacityCarton - slot.carton;
      if (free <= 0) {
        levelIdx += 1;
        continue;
      }
      const put = Math.min(remaining, free);
      fillLevelCartons(slot, slot.carton + put);
      remaining -= put;
      levelIdx += 1;
    }
  }

  return rackDefs.map((rack) => {
    const view = buildRackView(rack, levels);
    // Khu A: không gán tên khách ở đầu kệ (nhiều khách / xem theo mâm)
    if (rack.zone === 'A') {
      view.primaryCustomer = '';
    }
    return view;
  });
}

/**
 * Khu B/C: 1 tầng = 1 mâm = tối đa 1 khách.
 */
function allocateOneCustomerPerLevel(
  rackDefs: RackDef[],
  customerCartons: Map<string, number>
): StorageRackView[] {
  const levels: StorageLevelSlot[] = [];
  for (const rack of rackDefs) {
    for (let lv = 1; lv <= LEVELS_PER_RACK; lv++) {
      levels.push(emptyLevel(rack.id, lv));
    }
  }

  const sortedCustomers = [...customerCartons.entries()]
    .filter(([, carton]) => carton > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi'));

  let levelIdx = 0;
  for (const [customer, totalCarton] of sortedCustomers) {
    let remaining = totalCarton;
    while (remaining > 0 && levelIdx < levels.length) {
      const slot = levels[levelIdx];
      if (slot.customer && slot.customer !== customer) {
        levelIdx += 1;
        continue;
      }
      slot.customer = customer;
      const free = slot.capacityCarton - slot.carton;
      if (free <= 0) {
        levelIdx += 1;
        continue;
      }
      const put = Math.min(remaining, free);
      fillLevelCartons(slot, slot.carton + put);
      remaining -= put;
      // 1 mâm chỉ 1 khách — sang mâm kế tiếp nếu còn dư hoặc đã dùng mâm này
      levelIdx += 1;
    }
  }

  return rackDefs.map((rack) => buildRackView(rack, levels));
}

/** Gom carton theo khách từ danh sách mã TP. */
export function buildCustomerCartonMap(
  rows: Array<{ customer: string; carton: number }>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const customer = String(row.customer || '').trim() || 'Không xác định';
    map.set(customer, (map.get(customer) || 0) + (Number(row.carton) || 0));
  }
  return map;
}

function filterCartonsForRacks(
  allCartons: Map<string, number>,
  rackDefs: RackDef[]
): Map<string, number> {
  const out = new Map<string, number>();
  allCartons.forEach((carton, customer) => {
    if (rackDefs.some((r) => customerBelongsToRack(customer, r))) {
      out.set(customer, carton);
    }
  });
  return out;
}

export function buildStorageZones(
  rows: Array<{ customer: string; carton: number }>
): StorageZoneView[] {
  const allCartons = buildCustomerCartonMap(rows);

  const zones: Array<{ key: string; title: string; subtitle: string }> = [
    {
      key: 'A',
      title: 'Khu A',
      subtitle:
        `A1–A4 + A5/A6 (dư) · A1.2: SAMPLE · A5.1–A5.5, A6.1: ${ZONE_A_RESERVED_CUSTOMERS.join(', ')}`
    },
    {
      key: 'B-GIL',
      title: 'Khu B — GIL / HOB',
      subtitle: 'B1–B6 · tầng1: 42 ct/PL · tầng2: 3 ct/PL · mỗi mâm 3 pallet'
    },
    {
      key: 'B-SCIEN',
      title: 'Khu B — Scien',
      subtitle: 'B7–B9 · tầng1: 42 ct/PL · tầng2: 3 ct/PL'
    },
    {
      key: 'C-AXON',
      title: 'Khu C — Axon',
      subtitle: 'C1–C6 · tầng1: 42 ct/PL · tầng2: 3 ct/PL · mỗi mâm 3 pallet'
    },
    {
      key: 'C-SCIEN',
      title: 'Khu C — Scien',
      subtitle: 'C7–C9 · mặc định 18 ct/pallet'
    }
  ];

  return zones.map((z) => {
    const defs = racksForZone(z.key);
    const cartons = filterCartonsForRacks(allCartons, defs);
    return {
      key: z.key,
      title: z.title,
      subtitle: z.subtitle,
      racks:
        z.key === 'A'
          ? allocateZoneA(defs, cartons)
          : allocateOneCustomerPerLevel(defs, cartons)
    };
  });
}

/** Rút gọn tên khách để hiển thị trên ô tầng. */
export function shortStorageCustomerLabel(customer: string): string {
  const raw = String(customer || '').trim();
  if (!raw || raw === '—') return '—';
  if (raw.includes(' + ')) {
    return raw
      .split(' + ')
      .map((part) => shortStorageCustomerLabel(part))
      .join('+');
  }
  const allCodes = [
    ...ZONE_A_CUSTOMERS,
    ...ZONE_B_GIL_HOB_CUSTOMERS,
    ...ZONE_SCIEN_CUSTOMERS,
    ...ZONE_AXON_CUSTOMERS
  ];
  for (const code of allCodes) {
    if (matchesStorageCustomer(raw, code)) return code;
  }
  if (raw.length <= 8) return raw;
  return raw.slice(0, 8);
}

export const STORAGE_LAYOUT_RULES = {
  levelsPerRack: LEVELS_PER_RACK,
  palletsPerLevel: PALLETS_PER_LEVEL,
  maxCartonPerPallet: MAX_CARTON_PER_PALLET,
  maxCartonPerPalletBcL1: MAX_CARTON_PER_PALLET_BC_L1,
  maxCartonPerPalletBcL2: MAX_CARTON_PER_PALLET_BC_L2,
  maxLotPerPallet: MAX_LOT_PER_PALLET,
  levelCapacityCarton: LEVEL_CAPACITY_CARTON,
  rackCapacityCarton: RACK_CAPACITY_CARTON
};

export interface StorageInventoryLine {
  id?: string;
  materialCode: string;
  customer: string;
  location: string;
  ton: number;
  carton?: number;
  batchNumber?: string;
  lot?: string;
  lsx?: string;
  factory?: string;
  editHistory?: Array<{ action: string; by: string; at: Date | string; detail?: string }>;
}

/** Chuẩn hóa vị trí để so khớp. */
export function normalizeStorageLocation(location: string): string {
  return String(location || '').trim().toUpperCase();
}

/**
 * Dòng tồn có thuộc pallet/ô không?
 * - Khớp đúng C1.4A hoặc C1.4A-F1-111
 * - Legacy A1.1-PL2
 * - Hoặc chỉ ghi mâm C1.4 → thuộc mọi ô của mâm
 * - Hoặc chỉ scan mã pallet F1-111 → khớp nếu location kết thúc bằng mã đó
 */
export function inventoryLineMatchesPallet(location: string, palletLabel: string): boolean {
  const loc = normalizeStorageLocation(location);
  const pallet = normalizeStorageLocation(palletLabel);
  if (!loc || !pallet) return false;
  if (loc === pallet) return true;

  // Khớp theo mã QR pallet (dời hàng chỉ scan mã pallet)
  const qrFromLoc = extractPalletQrCode(loc);
  const qrFromQuery = extractPalletQrCode(pallet);
  if (qrFromQuery && qrFromLoc && qrFromLoc === qrFromQuery) return true;
  if (qrFromQuery && !parseStorageSlotLocation(pallet) && loc.endsWith(qrFromQuery)) return true;

  const parsedPallet = parseStorageSlotLocation(pallet);
  if (!parsedPallet) return false;
  const parsedLoc = parseStorageSlotLocation(loc);
  if (!parsedLoc) return false;
  if (parsedLoc.label !== parsedPallet.label) return false;
  if (!parsedLoc.palletNo) return true;
  if (!parsedPallet.palletNo) return true;
  return parsedLoc.palletNo === parsedPallet.palletNo;
}

export interface StorageCheckIssue {
  type: 'multi_customer' | 'wrong_zone' | 'invalid_location' | 'unknown_rack';
  slotLabel: string;
  location: string;
  materialCode: string;
  customer: string;
  detail: string;
}

export interface StorageCheckResult {
  scannedLines: number;
  scannedSlots: number;
  wrongSlotCount: number;
  issues: StorageCheckIssue[];
}

const KNOWN_RACK_IDS = new Set(RACK_DEFS.map((r) => r.id));

/**
 * Parse vị trí FG Inventory → mâm kệ.
 * Hỗ trợ: C1.4A, C1.4A-F1-111, C1.4-PL1, C1.4, A6-1, A61…
 */
export function parseStorageSlotLocation(location: string): {
  rackId: string;
  level: number;
  label: string;
  palletNo?: number;
  palletLabel?: string;
  slotLetter?: string;
  palletQrCode?: string;
} | null {
  const raw = String(location || '').trim().toUpperCase();
  if (!raw || raw === 'TEMPORARY' || /^TEMP-[123]$/.test(raw)) return null;

  // C1.4A-F1-111 / C1.4A
  let m = raw.match(/^([ABC])(\d+)\.(\d+)([ABC])(?:-(.+))?$/);
  if (m) {
    const rackId = `${m[1]}${Number(m[2])}`;
    const level = Number(m[3]);
    const slotLetter = m[4];
    const palletNo = palletLetterToNo(slotLetter);
    const qr = m[5] ? normalizePalletQrCode(m[5]) : '';
    if (level >= 1 && level <= LEVELS_PER_RACK && palletNo >= 1) {
      const label = `${rackId}.${level}`;
      return {
        rackId,
        level,
        label,
        palletNo,
        slotLetter,
        palletLabel: buildPalletLabel(label, palletNo),
        palletQrCode: qr || undefined
      };
    }
    return null;
  }

  // Legacy: A1.1-PL2 / A1.1_PL2 / A1.1PL2 (+ optional -QR)
  m = raw.match(/^([ABC])(\d+)\.(\d+)[-_]?PL(\d+)(?:-(.+))?$/);
  if (m) {
    const rackId = `${m[1]}${Number(m[2])}`;
    const level = Number(m[3]);
    const palletNo = Number(m[4]);
    const qr = m[5] ? normalizePalletQrCode(m[5]) : '';
    if (level >= 1 && level <= LEVELS_PER_RACK && palletNo >= 1 && palletNo <= PALLETS_PER_LEVEL) {
      const label = `${rackId}.${level}`;
      return {
        rackId,
        level,
        label,
        palletNo,
        slotLetter: palletNoToLetter(palletNo),
        palletLabel: buildPalletLabel(label, palletNo),
        palletQrCode: qr || undefined
      };
    }
    return null;
  }

  m = raw.match(/^([ABC])(\d+)\.(\d+)$/);
  if (m) {
    const rackId = `${m[1]}${Number(m[2])}`;
    const level = Number(m[3]);
    if (level >= 1 && level <= LEVELS_PER_RACK) {
      return { rackId, level, label: `${rackId}.${level}` };
    }
    return null;
  }

  m = raw.match(/^([ABC])(\d+)[-/](\d+)$/);
  if (m) {
    const rackId = `${m[1]}${Number(m[2])}`;
    const level = Number(m[3]);
    if (level >= 1 && level <= LEVELS_PER_RACK) {
      return { rackId, level, label: `${rackId}.${level}` };
    }
    return null;
  }

  const compact = raw.replace(/[^A-Z0-9]/g, '');
  // C14A / C14APALLET…
  m = compact.match(/^([ABC])(\d{1,2})(\d)([ABC])(.*)$/);
  if (m) {
    const rackId = `${m[1]}${Number(m[2])}`;
    const level = Number(m[3]);
    const palletNo = palletLetterToNo(m[4]);
    if (
      level >= 1 &&
      level <= LEVELS_PER_RACK &&
      palletNo >= 1 &&
      KNOWN_RACK_IDS.has(rackId)
    ) {
      const label = `${rackId}.${level}`;
      return {
        rackId,
        level,
        label,
        palletNo,
        slotLetter: palletNoToLetter(palletNo),
        palletLabel: buildPalletLabel(label, palletNo),
        palletQrCode: m[5] ? normalizePalletQrCode(m[5]) : undefined
      };
    }
  }

  m = compact.match(/^([ABC])(\d{1,2})(\d)PL(\d+)(.*)$/);
  if (m) {
    const rackId = `${m[1]}${Number(m[2])}`;
    const level = Number(m[3]);
    const palletNo = Number(m[4]);
    if (
      level >= 1 &&
      level <= LEVELS_PER_RACK &&
      palletNo >= 1 &&
      palletNo <= PALLETS_PER_LEVEL &&
      KNOWN_RACK_IDS.has(rackId)
    ) {
      const label = `${rackId}.${level}`;
      return {
        rackId,
        level,
        label,
        palletNo,
        slotLetter: palletNoToLetter(palletNo),
        palletLabel: buildPalletLabel(label, palletNo),
        palletQrCode: m[5] ? normalizePalletQrCode(m[5]) : undefined
      };
    }
  }

  m = compact.match(/^([ABC])(\d{1,2})(\d)$/);
  if (m) {
    const rackId = `${m[1]}${Number(m[2])}`;
    const level = Number(m[3]);
    if (level >= 1 && level <= LEVELS_PER_RACK && KNOWN_RACK_IDS.has(rackId)) {
      return { rackId, level, label: `${rackId}.${level}` };
    }
  }

  return null;
}

function getRackDef(rackId: string): RackDef | undefined {
  return RACK_DEFS.find((r) => r.id === rackId);
}

/** Khách được phép ở kệ này theo quy tắc khu. */
export function isCustomerAllowedOnRack(customer: string, rackId: string): boolean {
  const rack = getRackDef(rackId);
  if (!rack) return false;
  return customerBelongsToRack(customer, rack);
}

/**
 * Dò vị trí + mã TP trong FG Inventory:
 * - 1 mâm (tầng) không được có 2 khách
 * - Khách phải đúng khu kệ (A/B/C)
 */
export function checkStorageLocations(lines: StorageInventoryLine[]): StorageCheckResult {
  const issues: StorageCheckIssue[] = [];
  const bySlot = new Map<
    string,
    { rackId: string; customers: Set<string>; lines: StorageInventoryLine[] }
  >();

  for (const line of lines) {
    const ton = Number(line.ton) || 0;
    if (ton <= 0) continue;

    const loc = String(line.location || '').trim();
    const parsed = parseStorageSlotLocation(loc);
    const customer = String(line.customer || '').trim() || 'Không xác định';
    const materialCode = String(line.materialCode || '').trim().toUpperCase();

    if (!parsed) {
      if (/^[ABC]/i.test(loc)) {
        issues.push({
          type: 'invalid_location',
          slotLabel: '—',
          location: loc,
          materialCode,
          customer,
          detail: 'Không parse được mâm kệ (cần dạng A6.1, B3.2…)'
        });
      }
      continue;
    }

    if (!KNOWN_RACK_IDS.has(parsed.rackId)) {
      issues.push({
        type: 'unknown_rack',
        slotLabel: parsed.label,
        location: loc,
        materialCode,
        customer,
        detail: `Kệ ${parsed.rackId} không thuộc sơ đồ lưu trữ`
      });
      continue;
    }

    if (!isCustomerAllowedOnSlot(customer, parsed.rackId, parsed.level)) {
      const reserved = getReservedCodeForSlot(parsed.rackId, parsed.level);
      issues.push({
        type: 'wrong_zone',
        slotLabel: parsed.label,
        location: loc,
        materialCode,
        customer,
        detail: reserved
          ? `Mâm ${parsed.label} dành cho ${reserved} — không phải ${shortStorageCustomerLabel(customer)}`
          : `Khách ${shortStorageCustomerLabel(customer)} không thuộc khu kệ ${parsed.rackId}`
      });
    }

    if (!bySlot.has(parsed.label)) {
      bySlot.set(parsed.label, { rackId: parsed.rackId, customers: new Set(), lines: [] });
    }
    const slot = bySlot.get(parsed.label)!;
    slot.customers.add(customer);
    slot.lines.push(line);
  }

  bySlot.forEach((slot, slotLabel) => {
    if (slot.customers.size <= 1) return;
    const khList = [...slot.customers].map((c) => shortStorageCustomerLabel(c)).join(', ');
    for (const line of slot.lines) {
      issues.push({
        type: 'multi_customer',
        slotLabel,
        location: line.location,
        materialCode: String(line.materialCode || '').trim().toUpperCase(),
        customer: line.customer,
        detail: `Mâm ${slotLabel} có ${slot.customers.size} khách: ${khList}`
      });
    }
  });

  const wrongSlots = new Set(
    issues.filter((i) => i.type === 'multi_customer' || i.type === 'wrong_zone').map((i) => i.slotLabel)
  );

  return {
    scannedLines: lines.filter((l) => (Number(l.ton) || 0) > 0).length,
    scannedSlots: bySlot.size,
    wrongSlotCount: wrongSlots.size,
    issues: issues.sort(
      (a, b) =>
        a.slotLabel.localeCompare(b.slotLabel) ||
        a.type.localeCompare(b.type) ||
        a.materialCode.localeCompare(b.materialCode)
    )
  };
}
