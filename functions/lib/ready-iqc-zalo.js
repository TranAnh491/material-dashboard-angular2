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
exports.notifyReadyIqcWaiting = notifyReadyIqcWaiting;
/**
 * LSX Ready-IQC: báo nhóm PLN và WH ASM1 các mã NVL đang ở vị trí IQC, chưa Pass.
 */
const admin = __importStar(require("firebase-admin"));
const params_config_1 = require("./params-config");
const NOTICE_COLLECTION = 'ready-iqc-zalo';
function fold(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}
function groupBlob(id, data) {
    return fold([id, data === null || data === void 0 ? void 0 : data.label, data === null || data === void 0 ? void 0 : data.name, data === null || data === void 0 ? void 0 : data.purpose, data === null || data === void 0 ? void 0 : data.key].filter(Boolean).join(' '));
}
function isPlnGroup(id, data) {
    const blob = groupBlob(id, data);
    return blob === 'pln' || blob.includes('nhompln') || blob.includes('pln');
}
function isWhAsm1Group(id, data) {
    const blob = groupBlob(id, data);
    if (blob.includes('pln'))
        return false;
    return blob === 'khoasm1' || blob === 'whasm1' || blob.includes('whasm1') || blob.includes('khoasm1');
}
function lsxDocId(lsx) {
    return lsx
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '')
        .replace(/\//g, '_')
        .replace(/[^A-Z0-9._-]/g, '')
        .slice(0, 80);
}
async function sendText(token, chatId, text) {
    const url = `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/sendMessage`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 2000) })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || (body && body.ok === false)) {
        throw new Error(`Zalo sendMessage failed: ${res.status} ${JSON.stringify(body)}`);
    }
}
async function resolveGroups(db) {
    const snap = await db.collection('zalo_group_config').get();
    let pln = '';
    let whAsm1 = '';
    snap.docs.forEach((doc) => {
        var _a;
        const chatId = String(((_a = doc.data()) === null || _a === void 0 ? void 0 : _a.chatId) || '').trim();
        if (!chatId)
            return;
        if (!pln && isPlnGroup(doc.id, doc.data()))
            pln = chatId;
        if (!whAsm1 && isWhAsm1Group(doc.id, doc.data()))
            whAsm1 = chatId;
    });
    const missing = [];
    if (!pln)
        missing.push('PLN (zalo_group_config, tên/nhãn có PLN)');
    if (!whAsm1)
        missing.push('WH ASM1 (zalo_group_config/kho_asm1 hoặc wh_asm1)');
    if (missing.length) {
        throw new Error(`Chưa gắn nhóm: ${missing.join('; ')}.`);
    }
    return { pln, whAsm1 };
}
async function notifyReadyIqcWaiting(db, opts) {
    var _a;
    const token = params_config_1.zaloBotToken.value().trim();
    if (!token)
        throw new Error('Thiếu ZALO_BOT_TOKEN');
    const lsx = String((opts === null || opts === void 0 ? void 0 : opts.lsx) || '').trim().slice(0, 40);
    const docId = lsxDocId(lsx);
    if (!lsx || !docId)
        throw new Error('Thiếu LSX.');
    const factory = String((opts === null || opts === void 0 ? void 0 : opts.factory) || '').trim().toUpperCase().slice(0, 16);
    const items = (Array.isArray(opts === null || opts === void 0 ? void 0 : opts.items) ? opts.items : [])
        .map((item) => ({
        materialCode: String((item === null || item === void 0 ? void 0 : item.materialCode) || '').trim().toUpperCase().slice(0, 40),
        po: String((item === null || item === void 0 ? void 0 : item.po) || '').trim().slice(0, 80),
        location: String((item === null || item === void 0 ? void 0 : item.location) || '').trim().slice(0, 40),
        iqcStatus: String((item === null || item === void 0 ? void 0 : item.iqcStatus) || '').trim().slice(0, 40) || 'Chưa pass'
    }))
        .filter((item) => item.materialCode);
    if (!items.length)
        return { sent: false };
    const signature = items
        .map((item) => `${item.materialCode}|${item.po}|${item.iqcStatus}`)
        .sort()
        .join('\n');
    const noticeRef = db.collection(NOTICE_COLLECTION).doc(docId);
    const prev = await noticeRef.get();
    if (String(((_a = prev.data()) === null || _a === void 0 ? void 0 : _a.signature) || '') === signature)
        return { sent: false };
    const { pln, whAsm1 } = await resolveGroups(db);
    const codes = items.map((item) => item.materialCode);
    const shown = codes.slice(0, 30);
    const more = codes.length - shown.length;
    const codeText = more > 0 ? `${shown.join(', ')} và ${more} mã nữa` : shown.join(', ');
    const text = `Chào chị Hồng,\nLSX ${lsx} đã ready, nhưng chờ mã ${codeText}`;
    await sendText(token, pln, text);
    await sendText(token, whAsm1, text);
    await noticeRef.set({
        lsx,
        factory,
        signature,
        itemCount: items.length,
        notifiedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { sent: true };
}
//# sourceMappingURL=ready-iqc-zalo.js.map