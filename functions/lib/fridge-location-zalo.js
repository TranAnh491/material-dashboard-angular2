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
exports.violationFromInventory = violationFromInventory;
exports.sendFridgeLocationZaloReport = sendFridgeLocationZaloReport;
exports.notifyFridgeLocationOnWrite = notifyFridgeLocationOnWrite;
const admin = __importStar(require("firebase-admin"));
const zalo_notify_util_1 = require("./zalo-notify.util");
/** Khớp src/app/pages/materials/fridge-nvl-catalog.ts — mọi mã B037 phải ở HOACHAT. */
const B037_REQUIRED_LOCATION = 'HOACHAT';
const KHO_GROUP_DOC = 'zalo_group_config/quanly_kho';
const DEDUPE_COLLECTION = 'fridge-location-zalo';
const DEDUPE_MS = 12 * 60 * 60 * 1000;
const FACTORIES = ['ASM1', 'ASM2'];
function groupCodeOf(materialCode) {
    const compact = String(materialCode || '').replace(/\s/g, '').toUpperCase();
    const match = /^B(\d{6})/.exec(compact);
    return match ? `B${match[1]}` : '';
}
function isB037Code(materialCode) {
    return groupCodeOf(materialCode).startsWith('B037');
}
function locationTokens(location) {
    return String(location || '')
        .split(/[,;/\n|]+/)
        .map((part) => part.trim())
        .filter(Boolean);
}
function isHoachatLocation(location) {
    const tokens = locationTokens(location).map((part) => part.replace(/\s/g, '').toUpperCase());
    return tokens.length > 0 && tokens.every((token) => token === 'HOACHAT');
}
function availableStock(data) {
    const qty = Number(data['quantity']) || 0;
    const exported = Number(data['exported']) || 0;
    const xt = Number(data['xt']) || 0;
    const openingRaw = data['openingStock'];
    const opening = openingRaw != null && openingRaw !== '' ? Number(openingRaw) || 0 : 0;
    if (qty !== 0 || exported !== 0 || xt !== 0 || opening !== 0) {
        return opening + qty - exported - xt;
    }
    const stock = Number(data['stock']);
    return Number.isFinite(stock) ? stock : 0;
}
function readLocation(data) {
    var _a, _b;
    return String((_b = (_a = data['location']) !== null && _a !== void 0 ? _a : data['viTri']) !== null && _b !== void 0 ? _b : '').trim();
}
function violationFromInventory(factory, data) {
    if (factory !== 'ASM1' && factory !== 'ASM2')
        return null;
    const materialCode = String(data['materialCode'] || '').trim().toUpperCase();
    if (!isB037Code(materialCode))
        return null;
    if (availableStock(data) <= 0)
        return null;
    const location = readLocation(data);
    if (isHoachatLocation(location))
        return null;
    return {
        factory,
        materialCode: groupCodeOf(materialCode),
        location: location || '(chưa có vị trí)',
        poNumber: String(data['poNumber'] || '').trim()
    };
}
function formatLines(rows) {
    return rows.map((row) => {
        const po = row.poNumber ? ` | PO ${row.poNumber}` : '';
        return `- ${row.factory} · ${row.materialCode}${po} | đang ở ${row.location}`;
    });
}
function chunkText(title, lines, max = 1900) {
    const chunks = [];
    let current = title;
    for (const line of lines) {
        const next = `${current}\n${line}`;
        if (next.length > max && current !== title) {
            chunks.push(current);
            current = `${title}\n${line}`;
        }
        else {
            current = next;
        }
    }
    if (current !== title)
        chunks.push(current);
    return chunks;
}
async function khoChatId(db) {
    var _a;
    const doc = await db.doc(KHO_GROUP_DOC).get();
    return String(((_a = doc.data()) === null || _a === void 0 ? void 0 : _a.chatId) || '').trim();
}
async function sendReport(db, title, rows) {
    if (!rows.length)
        return 0;
    const chatId = await khoChatId(db);
    if (!chatId) {
        console.error('fridge-location-zalo: chưa gắn nhóm Kho');
        return 0;
    }
    let sent = 0;
    for (const text of chunkText(title, formatLines(rows))) {
        if (await (0, zalo_notify_util_1.sendZaloToChat)(chatId, text))
            sent += 1;
    }
    return sent;
}
function dedupeId(row) {
    const loc = row.location.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 80) || 'empty';
    return `${row.factory}_${row.materialCode}_${loc}`.slice(0, 700);
}
async function recentlySent(db, row) {
    var _a;
    const snap = await db.collection(DEDUPE_COLLECTION).doc(dedupeId(row)).get();
    const at = (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.sentAt;
    const ms = typeof (at === null || at === void 0 ? void 0 : at.toMillis) === 'function' ? at.toMillis() : 0;
    return ms > 0 && Date.now() - ms < DEDUPE_MS;
}
async function markSent(db, row) {
    await db.collection(DEDUPE_COLLECTION).doc(dedupeId(row)).set(Object.assign(Object.assign({}, row), { sentAt: admin.firestore.FieldValue.serverTimestamp() }));
}
/** Quét tồn ASM1 và ASM2. Mã B037 không ở HOACHAT thì báo nhóm Kho. */
async function sendFridgeLocationZaloReport(db) {
    const rows = [];
    for (const factory of FACTORIES) {
        const snap = await db.collection('inventory-materials').where('factory', '==', factory).get();
        snap.docs.forEach((doc) => {
            const row = violationFromInventory(factory, doc.data());
            if (row)
                rows.push(row);
        });
    }
    rows.sort((a, b) => a.factory.localeCompare(b.factory) || a.materialCode.localeCompare(b.materialCode));
    if (!rows.length)
        return { sent: 0, violations: 0 };
    const sent = await sendReport(db, `B037 — SAI VỊ TRÍ\nVị trí đúng: ${B037_REQUIRED_LOCATION}`, rows);
    return { sent, violations: rows.length };
}
/** Báo ngay khi dòng tồn B037 đổi sang vị trí không phải HOACHAT. */
async function notifyFridgeLocationOnWrite(db, before, after) {
    if (!after)
        return { sent: 0 };
    const factory = String(after['factory'] || '');
    const row = violationFromInventory(factory, after);
    if (!row)
        return { sent: 0 };
    const beforeLoc = before ? readLocation(before) : null;
    const afterLoc = readLocation(after);
    if (before && beforeLoc === afterLoc)
        return { sent: 0 };
    if (await recentlySent(db, row))
        return { sent: 0 };
    const sent = await sendReport(db, `B037 — SAI VỊ TRÍ\nVị trí đúng: ${B037_REQUIRED_LOCATION}`, [row]);
    if (sent > 0)
        await markSent(db, row);
    return { sent };
}
//# sourceMappingURL=fridge-location-zalo.js.map