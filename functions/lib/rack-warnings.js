"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeAndCacheRackWarnings = computeAndCacheRackWarnings;
const admin = __importStar(require("firebase-admin"));
const CACHE_COLLECTION = 'dashboard-cache';
const CACHE_DOC = 'rack-warnings';
const FACTORY = 'ASM1';
/** Vị trí dạng chữ+2 số (VD: A01, B12) lấy từ 3 ký tự đầu location. */
function normalizePosition(location) {
    if (!location)
        return '';
    const cleaned = location.replace(/[.,]/g, '').substring(0, 3).toUpperCase();
    return /^[A-G]\d{2}$/.test(cleaned) ? cleaned : '';
}
/**
 * Tính rack utilization warnings 1 lần và lưu vào `dashboard-cache/rack-warnings`.
 * Chạy 1 lần/ngày lúc 8h (Asia/Ho_Chi_Minh) qua Cloud Scheduler — xem index.ts.
 * Dashboard client CHỈ đọc doc này (1 read) thay vì tự quét inventory-materials + materials
 * mỗi lần mở tab, nên số lượt đọc không nhân theo số máy/số lần mở tab nữa.
 */
async function computeAndCacheRackWarnings(db) {
    const inventorySnap = await db.collection('inventory-materials').where('factory', '==', FACTORY).get();
    const materials = inventorySnap.docs.map((doc) => doc.data());
    const catalogSnap = await db.collection('materials').get();
    const catalogCache = new Map();
    catalogSnap.docs.forEach((doc) => {
        const item = doc.data();
        if (item['materialCode']) {
            const code = String(item['materialCode']).trim().toUpperCase();
            catalogCache.set(code, { unitWeight: item['unitWeight'] || item['unit_weight'] || 0 });
        }
    });
    const positionMap = new Map();
    materials.forEach((material) => {
        var _a, _b;
        const position = normalizePosition(material.location || '');
        if (!position)
            return;
        const openingStock = material.openingStock !== null && material.openingStock !== undefined ? material.openingStock : 0;
        const stockQty = openingStock + (material.quantity || 0) - (material.exported || 0) - (material.xt || 0);
        if (stockQty <= 0)
            return;
        const materialCode = (_a = material.materialCode) === null || _a === void 0 ? void 0 : _a.toString().trim().toUpperCase();
        const unitWeightGram = ((_b = catalogCache.get(materialCode)) === null || _b === void 0 ? void 0 : _b.unitWeight) || 0;
        if (unitWeightGram <= 0)
            return;
        const weightKg = (stockQty * unitWeightGram) / 1000;
        const posData = positionMap.get(position) || { totalWeightKg: 0, itemCount: 0 };
        posData.totalWeightKg += weightKg;
        posData.itemCount++;
        positionMap.set(position, posData);
    });
    const warnings = [];
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
//# sourceMappingURL=rack-warnings.js.map