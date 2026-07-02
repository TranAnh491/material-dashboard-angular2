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
exports.saveWarehouseTrainingQuizImage = saveWarehouseTrainingQuizImage;
const admin = __importStar(require("firebase-admin"));
function safeText(s, max = 200) {
    return String(s !== null && s !== void 0 ? s : '').trim().slice(0, max);
}
function decodeImageDataUrl(imageDataUrl) {
    const m = /^data:image\/png;base64,(.+)$/i.exec(imageDataUrl || '');
    if (!(m === null || m === void 0 ? void 0 : m[1])) {
        throw new Error('imageDataUrl không hợp lệ (cần data:image/png;base64,...)');
    }
    return Buffer.from(m[1], 'base64');
}
function buildStoragePath(sectionId, employeeId, fullName) {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const safeEmp = (employeeId || 'NV').replace(/[^\w-]+/g, '_');
    const safeName = (fullName || 'nhan-vien').replace(/\s+/g, '_').replace(/[^\w-]+/g, '_');
    const fileName = `${yyyy}${mm}${dd}_${hh}${mi}${ss}_${sectionId}_${safeEmp}_${safeName}.png`;
    return `warehouse-training-quiz/${yyyy}-${mm}/${fileName}`.replace(/[^\w./-]/g, '_');
}
async function uploadImageAndGetSignedUrl(buf, storagePath) {
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    await file.save(buf, {
        contentType: 'image/png',
        resumable: false,
        metadata: { cacheControl: 'private, max-age=0, no-transform' }
    });
    const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 365 * 24 * 60 * 60 * 1000
    });
    return url;
}
async function saveWarehouseTrainingQuizImage(db, payload) {
    const buf = decodeImageDataUrl(payload.imageDataUrl);
    if (!(buf === null || buf === void 0 ? void 0 : buf.length))
        throw new Error('File hình rỗng');
    const employeeId = safeText(payload.employeeId, 40);
    const fullName = safeText(payload.fullName, 120);
    const joinDate = safeText(payload.joinDate, 40);
    const sectionId = safeText(payload.sectionId, 40);
    const sectionTitle = safeText(payload.sectionTitle, 120);
    const resultText = safeText(payload.resultText, 600);
    const storagePath = buildStoragePath(sectionId, employeeId, fullName);
    const downloadUrl = await uploadImageAndGetSignedUrl(buf, storagePath);
    const docRef = await db.collection('warehouse-training-quiz-results').add({
        fullName,
        employeeId,
        joinDate,
        sectionId,
        sectionTitle,
        resultText,
        storagePath,
        downloadUrl,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { ok: true, id: docRef.id, downloadUrl, storagePath };
}
//# sourceMappingURL=warehouse-training-quiz-storage.js.map