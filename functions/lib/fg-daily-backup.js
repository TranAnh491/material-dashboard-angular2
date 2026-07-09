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
exports.runFgDailyBackupJob = runFgDailyBackupJob;
const admin = __importStar(require("firebase-admin"));
const FG_BACKUP_ROOT = 'fg-daily-backups';
const CHUNK_SIZE = 250;
const COLLECTIONS = [
    { key: 'fg-inventory', source: 'fg-inventory' },
    { key: 'fg-in', source: 'fg-in' },
    { key: 'fg-out', source: 'fg-out' },
    { key: 'fg-check', source: 'fg-check' }
];
function formatYmdInTz(date) {
    var _a, _b, _c;
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const y = ((_a = parts.find((p) => p.type === 'year')) === null || _a === void 0 ? void 0 : _a.value) || '1970';
    const m = ((_b = parts.find((p) => p.type === 'month')) === null || _b === void 0 ? void 0 : _b.value) || '01';
    const d = ((_c = parts.find((p) => p.type === 'day')) === null || _c === void 0 ? void 0 : _c.value) || '01';
    return `${y}-${m}-${d}`;
}
function shiftYmd(ymd, days) {
    const [y, m, d] = ymd.split('-').map((x) => Number(x));
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return formatYmdInTz(dt);
}
async function backupCollection(db, key, source, dayYmd) {
    var _a;
    const dayKey = Number(dayYmd.replace(/-/g, '')) || 0;
    const dayRef = db.collection(FG_BACKUP_ROOT).doc(key).collection('days').doc(String(dayKey));
    const existing = await dayRef.get();
    if (existing.exists) {
        return Number(((_a = existing.data()) === null || _a === void 0 ? void 0 : _a.itemCount) || 0) || 0;
    }
    const snap = await db.collection(source).get();
    const items = snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    const chunkCount = Math.max(1, Math.ceil(items.length / CHUNK_SIZE));
    const chunksCol = dayRef.collection('chunks');
    await dayRef.set({
        collectionKey: key,
        dayKey,
        dateYmd: dayYmd,
        itemCount: items.length,
        chunkCount,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    for (let i = 0; i < chunkCount; i++) {
        const slice = items.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        await chunksCol.doc(String(i).padStart(3, '0')).set({ index: i, items: slice });
    }
    return items.length;
}
/** Backup cuối ngày hôm qua (VN) cho các collection FG. */
async function runFgDailyBackupJob() {
    const db = admin.firestore();
    const backupYmd = shiftYmd(formatYmdInTz(new Date()), -1);
    for (const cfg of COLLECTIONS) {
        const count = await backupCollection(db, cfg.key, cfg.source, backupYmd);
        console.log(`[fg-daily-backup] ${cfg.key} ${backupYmd}: ${count} items`);
    }
}
//# sourceMappingURL=fg-daily-backup.js.map