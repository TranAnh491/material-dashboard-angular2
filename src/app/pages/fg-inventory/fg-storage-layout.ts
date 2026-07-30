/** Cấu hình & phân bổ sơ đồ kệ lưu trữ TP (Thống Kê TP theo thùng). */

export interface StorageLevelSlot {
  label: string;
  rackId: string;
  level: number;
  customer: string;
  carton: number;
  capacityCarton: number;
  utilizationPct: number;
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
const MAX_CARTON_PER_PALLET = 18;
const MAX_LOT_PER_PALLET = 3;

export const LEVEL_CAPACITY_CARTON = PALLETS_PER_LEVEL * MAX_CARTON_PER_PALLET;
export const RACK_CAPACITY_CARTON = LEVELS_PER_RACK * LEVEL_CAPACITY_CARTON;

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

function emptyLevel(rackId: string, level: number): StorageLevelSlot {
  return {
    label: `${rackId}.${level}`,
    rackId,
    level,
    customer: '',
    carton: 0,
    capacityCarton: LEVEL_CAPACITY_CARTON,
    utilizationPct: 0
  };
}

function buildRackView(rack: RackDef, levels: StorageLevelSlot[]): StorageRackView {
  const rackLevels = levels.filter((l) => l.rackId === rack.id).sort((a, b) => b.level - a.level);
  const totalCarton = rackLevels.reduce((s, l) => s + l.carton, 0);
  const capacityCarton = rackLevels.length * LEVEL_CAPACITY_CARTON;
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

/** Khách được phép ở mâm (tầng) cụ thể — khu A có mâm cố định A5/A6. */
export function isCustomerAllowedOnSlot(customer: string, rackId: string, level: number): boolean {
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
 * Khu A: 6 mâm cố định A5/A6 cho OST…ADAM; khách chính xếp các mâm còn lại.
 */
function allocateZoneA(
  rackDefs: RackDef[],
  customerCartons: Map<string, number>
): StorageRackView[] {
  const levels: StorageLevelSlot[] = [];
  const reservedLabels = new Set(ZONE_A_RESERVED_SLOTS.map((s) => s.label));

  for (const rack of rackDefs) {
    for (let lv = 1; lv <= LEVELS_PER_RACK; lv++) {
      levels.push(emptyLevel(rack.id, lv));
    }
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
      const put = Math.min(totalCarton, slot.capacityCarton);
      slot.carton = put;
      slot.utilizationPct = put > 0 ? Math.min(100, Math.round((put / slot.capacityCarton) * 100)) : 0;
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
      if (reservedLabels.has(slot.label)) {
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
      slot.carton += put;
      slot.utilizationPct = Math.min(100, Math.round((slot.carton / slot.capacityCarton) * 100));
      remaining -= put;
      levelIdx += 1;
    }
  }

  return rackDefs.map((rack) => buildRackView(rack, levels));
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
      slot.carton += put;
      slot.utilizationPct = Math.min(100, Math.round((slot.carton / slot.capacityCarton) * 100));
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
        `A1–A4 + A5/A6 (dư) · A5.1–A5.5, A6.1: ${ZONE_A_RESERVED_CUSTOMERS.join(', ')}`
    },
    {
      key: 'B-GIL',
      title: 'Khu B — GIL / HOB',
      subtitle: 'Kệ B1–B6 · mỗi tầng 3 pallet'
    },
    {
      key: 'B-SCIEN',
      title: 'Khu B — Scien',
      subtitle: 'Kệ B7–B9'
    },
    {
      key: 'C-AXON',
      title: 'Khu C — Axon',
      subtitle: 'Kệ C1–C6'
    },
    {
      key: 'C-SCIEN',
      title: 'Khu C — Scien',
      subtitle: 'Kệ C7–C9'
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
  maxLotPerPallet: MAX_LOT_PER_PALLET,
  levelCapacityCarton: LEVEL_CAPACITY_CARTON,
  rackCapacityCarton: RACK_CAPACITY_CARTON
};

export interface StorageInventoryLine {
  materialCode: string;
  customer: string;
  location: string;
  ton: number;
  batchNumber?: string;
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

/** Parse vị trí FG Inventory → mâm kệ (vd. A6.1, A6-1, A61). */
export function parseStorageSlotLocation(location: string): {
  rackId: string;
  level: number;
  label: string;
} | null {
  const raw = String(location || '').trim().toUpperCase();
  if (!raw || raw === 'TEMPORARY' || raw === 'TEMP-1') return null;

  let m = raw.match(/^([ABC])(\d+)\.(\d+)$/);
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
