export type LocationWarehouseType = 'Kho Thường' | 'Kho Mát';

/** Kệ một chữ — kho thường. */
export const KHO_THUONG_RACK_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'P', 'J'] as const;

/** Kệ Quality — kho mát. */
export const KHO_MAT_RACK_LETTERS = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'O'] as const;

/** Vị trí đặc biệt — kho mát (không coi là kệ một chữ). */
export const KHO_MAT_NAMED_LOCATIONS = ['A12', 'H11', 'FRIDGE'] as const;

export function isNamedColdWarehouseLocation(loc: string): boolean {
  const raw = String(loc || '').replace(/\s/g, '').toUpperCase();
  return raw === 'FRIDGE' || raw === 'FRIGDE' || raw.startsWith('FRIDGE');
}

/** A12/H11/FRIDGE không khớp prefix một chữ (VD: A12 ≠ kệ A). */
export function blocksSingleLetterPrefixMatch(normalized: string, letter: string): boolean {
  const raw = String(normalized || '').replace(/\s/g, '').toUpperCase();
  if (isNamedColdWarehouseLocation(raw)) return true;
  if (letter === 'A' && raw.startsWith('A12')) return true;
  if (raw.startsWith('H11')) return true;
  return false;
}

export function getDefaultLegacyFirstCharMap(): Record<string, LocationWarehouseType> {
  const map: Record<string, LocationWarehouseType> = {};
  for (const c of KHO_THUONG_RACK_LETTERS) {
    map[c] = 'Kho Thường';
  }
  for (const c of KHO_MAT_RACK_LETTERS) {
    map[c] = 'Kho Mát';
  }
  return map;
}

export function getDefaultLocationByViTriMap(): Record<string, LocationWarehouseType> {
  return {
    A12: 'Kho Mát',
    H11: 'Kho Mát',
    FRIDGE: 'Kho Mát',
    FRIGDE: 'Kho Mát'
  };
}

export function getDefaultLocationsForWarehouse(warehouseType: LocationWarehouseType): string[] {
  if (warehouseType === 'Kho Thường') {
    return [...KHO_THUONG_RACK_LETTERS];
  }
  return [...KHO_MAT_NAMED_LOCATIONS, ...KHO_MAT_RACK_LETTERS];
}

export function mergeWarehouseMapsFromFirestore(
  locationByViTri: Record<string, LocationWarehouseType>,
  locationByFirstChar: Record<string, LocationWarehouseType>
): {
  locationByViTriMap: Record<string, LocationWarehouseType>;
  legacyFirstCharMap: Record<string, LocationWarehouseType>;
} {
  return {
    locationByViTriMap: { ...getDefaultLocationByViTriMap(), ...locationByViTri },
    legacyFirstCharMap: { ...getDefaultLegacyFirstCharMap(), ...locationByFirstChar }
  };
}
