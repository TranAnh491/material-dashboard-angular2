import * as admin from 'firebase-admin';

const CACHE_COLLECTION = 'dashboard-cache';
const CACHE_DOC = 'rack-warnings';
const FACTORY = 'ASM1';

export interface RackWarning {
  position: string;
  usage: number;
  currentLoad: number;
  maxCapacity: number;
  status: 'warning' | 'critical';
}

/** Vị trí dạng chữ+2 số (VD: A01, B12) lấy từ 3 ký tự đầu location. */
function normalizePosition(location: string): string {
  if (!location) return '';
  const cleaned = location.replace(/[.,]/g, '').substring(0, 3).toUpperCase();
  return /^[A-G]\d{2}$/.test(cleaned) ? cleaned : '';
}

/**
 * Tính rack utilization warnings 1 lần và lưu vào `dashboard-cache/rack-warnings`.
 * Chạy 1 lần/ngày lúc 8h (Asia/Ho_Chi_Minh) qua Cloud Scheduler — xem index.ts.
 * Dashboard client CHỈ đọc doc này (1 read) thay vì tự quét inventory-materials + materials
 * mỗi lần mở tab, nên số lượt đọc không nhân theo số máy/số lần mở tab nữa.
 */
export async function computeAndCacheRackWarnings(db: admin.firestore.Firestore): Promise<RackWarning[]> {
  const inventorySnap = await db.collection('inventory-materials').where('factory', '==', FACTORY).get();
  const materials = inventorySnap.docs.map((doc) => doc.data() as Record<string, any>);

  const catalogSnap = await db.collection('materials').get();
  const catalogCache = new Map<string, { unitWeight: number }>();
  catalogSnap.docs.forEach((doc) => {
    const item = doc.data() as Record<string, any>;
    if (item['materialCode']) {
      const code = String(item['materialCode']).trim().toUpperCase();
      catalogCache.set(code, { unitWeight: item['unitWeight'] || item['unit_weight'] || 0 });
    }
  });

  const positionMap = new Map<string, { totalWeightKg: number; itemCount: number }>();
  materials.forEach((material) => {
    const position = normalizePosition(material.location || '');
    if (!position) return;

    const openingStock = material.openingStock !== null && material.openingStock !== undefined ? material.openingStock : 0;
    const stockQty = openingStock + (material.quantity || 0) - (material.exported || 0) - (material.xt || 0);
    if (stockQty <= 0) return;

    const materialCode = material.materialCode?.toString().trim().toUpperCase();
    const unitWeightGram = catalogCache.get(materialCode)?.unitWeight || 0;
    if (unitWeightGram <= 0) return;

    const weightKg = (stockQty * unitWeightGram) / 1000;
    const posData = positionMap.get(position) || { totalWeightKg: 0, itemCount: 0 };
    posData.totalWeightKg += weightKg;
    posData.itemCount++;
    positionMap.set(position, posData);
  });

  const warnings: RackWarning[] = [];
  positionMap.forEach((data, position) => {
    // Vị trí kết thúc bằng '1' có sức chứa 5000kg, còn lại 1300kg (giống tab Rack Utilization).
    const maxCapacity = position.endsWith('1') ? 5000 : 1300;
    const usage = (data.totalWeightKg / maxCapacity) * 100;
    if (usage >= 80) {
      warnings.push({
        position,
        usage,
        currentLoad: data.totalWeightKg,
        maxCapacity,
        status: usage >= 95 ? 'critical' : 'warning'
      });
    }
  });
  warnings.sort((a, b) => b.usage - a.usage);

  const criticalCount = warnings.filter((w) => w.status === 'critical').length;
  const warningCount = warnings.filter((w) => w.status === 'warning').length;

  await db.collection(CACHE_COLLECTION).doc(CACHE_DOC).set({
    factory: FACTORY,
    warnings,
    criticalCount,
    warningCount,
    computedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return warnings;
}
