export type StorageUnitSize = 'XXS' | 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';

export interface StorageUnitSizeOption {
  size: StorageUnitSize;
  label: string;
  fraction: number;
  fractionLabel: string;
  description: string;
}

export const STORAGE_UNIT_SIZE_OPTIONS: StorageUnitSizeOption[] = [
  { size: 'XXS', label: 'XXS', fraction: 0.05, fractionLabel: '1/20', description: 'Chiếm 1/20 pallet (0,05 m³)' },
  { size: 'XS', label: 'XS', fraction: 0.1, fractionLabel: '1/10', description: 'Chiếm 1/10 pallet (0,1 m³)' },
  { size: 'S', label: 'S', fraction: 0.2, fractionLabel: '2/10', description: 'Chiếm 2/10 pallet (0,2 m³)' },
  { size: 'M', label: 'M', fraction: 0.4, fractionLabel: '4/10', description: 'Chiếm 4/10 pallet (0,4 m³)' },
  { size: 'L', label: 'L', fraction: 0.6, fractionLabel: '6/10', description: 'Chiếm 6/10 pallet (0,6 m³)' },
  { size: 'XL', label: 'XL', fraction: 0.8, fractionLabel: '8/10', description: 'Chiếm 8/10 pallet (0,8 m³)' },
  { size: 'XXL', label: 'XXL', fraction: 1, fractionLabel: '1/1', description: 'Chiếm 1 pallet đầy (1 m³)' }
];

export interface DvLuuTruCatalogEntry {
  id: string;
  factory: string;
  batchNumber: string;
  size: StorageUnitSize;
  fraction: number;
  updatedAt?: Date;
}

export function getStorageUnitOption(size: StorageUnitSize | string | null | undefined): StorageUnitSizeOption | null {
  if (!size) return null;
  return STORAGE_UNIT_SIZE_OPTIONS.find(o => o.size === size) || null;
}

export function getStorageUnitFraction(size: StorageUnitSize | string | null | undefined): number {
  return getStorageUnitOption(size)?.fraction ?? 0;
}
