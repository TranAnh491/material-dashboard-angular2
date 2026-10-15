import { listJKhoMatRowIds } from './layout-location-catalog';

/** Nhãn sơ đồ lưu trữ khi chưa có bản lưu trong Danh mục. */
export const SHELF_GROUP_DEFAULTS: Record<string, string> = {
  S01: 'B018',
  S03: 'B018',
  S05: 'B018',
  S07: 'B009',
  S08: 'B009',
  S09: 'B009',
  S10: 'B009',
  S11: 'B016',
  S12: 'B016',
  S13: 'B016',
  S14: 'B016',
  S15: 'B007',
  S16: 'B008',
  S17: 'B019, B020, B021, B026, B027, B039',
  S18: 'B022, B023, B024',
  S19: 'B034, B036',
  S20: 'B030, B031, B041, B043, B033',
  S23: 'R029',
  S24: 'R029',
  R09: 'Dây cáp B002, B005',
  R10: 'Dây cáp B003, B006',
  R11: 'B036, B042',
  HOACHAT: 'B037'
};

export function shelfGroupIds(): string[] {
  const ids = new Set<string>(listJKhoMatRowIds());
  for (let i = 1; i <= 30; i++) ids.add(`S${String(i).padStart(2, '0')}`);
  for (let i = 1; i <= 28; i++) ids.add(`R${String(i).padStart(2, '0')}`);
  Object.keys(SHELF_GROUP_DEFAULTS).forEach((id) => ids.add(id));
  const named = ['HOACHAT'];
  const sorted = [...ids].filter((id) => !named.includes(id)).sort((a, b) => {
    if (a[0] !== b[0]) return a[0] === 'S' ? -1 : 1;
    return Number(a.slice(1)) - Number(b.slice(1));
  });
  named.forEach((id) => {
    if (ids.has(id)) sorted.push(id);
  });
  return sorted;
}

export function normalizeShelfGroups(raw: string): string {
  return String(raw || '')
    .split(',')
    .map((part) => part.trim().replace(/\s+/g, ' ').replace(/\b([br]\d+)\b/gi, (token) => token.toUpperCase()))
    .filter(Boolean)
    .join(', ');
}

/** `saved` có key của kệ thì dùng đúng giá trị đó, kể cả khi để trống. */
export function shelfGroupRows(saved: Record<string, string> | null): Array<{ shelf: string; groups: string }> {
  return shelfGroupIds().map((shelf) => ({
    shelf,
    groups: saved && Object.prototype.hasOwnProperty.call(saved, shelf)
      ? normalizeShelfGroups(saved[shelf])
      : (SHELF_GROUP_DEFAULTS[shelf] || '')
  }));
}

export function shelfGroupText(
  shelf: string,
  saved: Record<string, string> | null
): { set: boolean; text: string } {
  if (saved && Object.prototype.hasOwnProperty.call(saved, shelf)) {
    return { set: true, text: normalizeShelfGroups(saved[shelf]) };
  }
  const preset = SHELF_GROUP_DEFAULTS[shelf];
  if (preset) return { set: true, text: preset };
  return { set: false, text: '' };
}
