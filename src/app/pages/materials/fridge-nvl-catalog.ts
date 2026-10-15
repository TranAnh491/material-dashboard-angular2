/** Mọi mã B037 (ASM1 và ASM2) có vị trí yêu cầu là kệ HOACHAT. */
export const B037_REQUIRED_LOCATION = 'HOACHAT';

/** Năm mã tủ lạnh thuộc loại hàng này; vị trí yêu cầu vẫn là HOACHAT. */
export const FRIDGE_NVL_TYPE = 'Tủ lạnh';

export const FRIDGE_NVL_CODES = ['B037005', 'B037015', 'B037016', 'B037034', 'B037030'] as const;

const FRIDGE_NVL_CODE_SET = new Set<string>(FRIDGE_NVL_CODES);

export function fridgeNvlGroupCode(materialCode: string | null | undefined): string {
  const compact = String(materialCode || '').replace(/\s/g, '').toUpperCase();
  const match = /^B(\d{6})/.exec(compact);
  return match ? `B${match[1]}` : '';
}

export function isFridgeNvlCode(materialCode: string | null | undefined): boolean {
  const group = fridgeNvlGroupCode(materialCode);
  return !!group && FRIDGE_NVL_CODE_SET.has(group);
}

/** Mọi nhóm mã B037xxx. */
export function isB037Code(materialCode: string | null | undefined): boolean {
  return fridgeNvlGroupCode(materialCode).startsWith('B037');
}
