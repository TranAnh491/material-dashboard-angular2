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
exports.KK_SCAN_GUIDE_TEXT = exports.ZALO_KHO_GROUP_DOC = void 0;
exports.sendKkScanGuideToKhoGroup = sendKkScanGuideToKhoGroup;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const admin = __importStar(require("firebase-admin"));
const zalo_notify_util_1 = require("./zalo-notify.util");
exports.ZALO_KHO_GROUP_DOC = 'zalo_group_config/quanly_kho';
const GUIDE_IMAGES = [
    { file: 'kk-scan-guide-kiem-ke.png', caption: 'Bài 1 — Đếm hàng trên kệ (kiểm kê)' },
    { file: 'kk-scan-guide-doi-vi-tri.png', caption: 'Bài 2 — Đổi kệ' },
    { file: 'kk-scan-guide-gom-ke.png', caption: 'Bài 3 — Một mã hàng chỉ để một chỗ' }
];
const HOSTING_IMG = 'https://airspeed-warehouse.web.app/assets/img';
exports.KK_SCAN_GUIDE_TEXT = `HƯỚNG DẪN SCAN — ĐỌC CHẬM, LÀM TỪNG BƯỚC

Giống xếp hình: làm xong bước 1 mới tới bước 2. Đừng nhảy cóc.

════════════════════════════════
BÀI 1 — ĐẾM HÀNG TRÊN KỆ (KIỂM KÊ)
════════════════════════════════

Bạn đứng trước một kệ. Việc của bạn là đếm xem kệ đó có đủ thùng không.

1) Bấm nút Scan (hình máy quét mã).
2) Lần đầu trong ca, quét THẺ NHÂN VIÊN (mã ASP + 4 số, ví dụ ASP0106).
   Máy nhớ bạn đến 12:00 trưa, 17:00 chiều, hoặc 20:00 tối.
   Hết giờ thì quét thẻ lại. Tắt tab / đóng máy cũng phải quét thẻ lại.
3) Quét TEM DÁN TRÊN KỆ. Ví dụ: S07-1-1. Đó là “địa chỉ nhà” của kệ.
4) Quét TEM TRÊN TỪNG THÙNG. Mỗi lần quét = 1 thùng.

Nhìn màn hình:
• “2/5 thùng” = đã quét 2, kệ cần 5 → còn thiếu, quét tiếp.
• Đủ số rồi thì xong kệ này.

Mẹo: quét sang mã hàng khác thì máy vẫn đứng ở CÙNG kệ.
Muốn sang kệ khác thì phải làm Bài 2.

════════════════════════════════
BÀI 2 — ĐỔI KỆ
════════════════════════════════

Khi muốn kiểm kê kệ khác:

1) Bấm nút “Đổi vị trí”.
2) Ô scan sẽ trống. Quét tem kệ MỚI.
3) Rồi quét từng thùng trên kệ mới, giống Bài 1.

Đừng quên bấm “Đổi vị trí”. Nếu không bấm, máy tưởng bạn vẫn đang đếm kệ cũ.

════════════════════════════════
BÀI 3 — MỘT MÃ HÀNG CHỈ ĐỂ MỘT CHỖ
════════════════════════════════

Cùng một mã hàng (ví dụ B009064) phải nằm chung một kệ. Không được rải 2 kệ.

Ví dụ:
• Mã B009064 đã có thùng ở kệ S07-1-1.
• Bạn lại quét vào kệ S08-1-2.
• Máy sẽ báo: hãy đưa hàng về S07-1-1.

Lúc đó bạn khiêng thùng về đúng kệ S07-1-1, rồi mới quét.

Được phép: đã có hàng ở dãy S07 thì được để vào ô S07-1-1 (cùng dãy).
Không tính kệ tạm F62 / IQC / NG — đó không phải “nhà” của mã hàng.

════════════════════════════════
NHỚ 3 ĐIỀU
════════════════════════════════

1. Quét thẻ NV → quét kệ → quét từng thùng.
2. Sang kệ khác: bấm “Đổi vị trí” rồi quét kệ mới.
3. Một mã hàng = một kệ. Máy bảo đưa về kệ nào thì đưa về đúng kệ đó.
`;
async function resolveKhoGroupChatId(db) {
    var _a;
    const doc = await db.doc(exports.ZALO_KHO_GROUP_DOC).get();
    const chatId = String(((_a = doc.data()) === null || _a === void 0 ? void 0 : _a.chatId) || '').trim();
    if (chatId)
        return chatId;
    throw new Error('Chưa gắn nhóm Quản lý kho trong zalo_group_config/quanly_kho.');
}
function loadGuideImageBuffer(file) {
    const local = path.join(__dirname, '..', 'assets', 'kk-scan-guide', file);
    try {
        if (fs.existsSync(local))
            return fs.readFileSync(local);
    }
    catch (_a) {
        /* ignore */
    }
    return null;
}
async function guideImagePublicUrl(file, buf) {
    const hosting = `${HOSTING_IMG}/${file}`;
    try {
        const res = await fetch(hosting, { method: 'GET' });
        const ctype = String(res.headers.get('content-type') || '');
        if (res.ok && ctype.startsWith('image/'))
            return hosting;
    }
    catch (_a) {
        /* fall through */
    }
    try {
        const bucket = admin.storage().bucket();
        const dest = `zalo-scan-guide/${file}`;
        const f = bucket.file(dest);
        await f.save(buf, {
            contentType: 'image/png',
            resumable: false,
            metadata: { cacheControl: 'public, max-age=86400' }
        });
        const [url] = await f.getSignedUrl({
            action: 'read',
            expires: Date.now() + 7 * 24 * 3600 * 1000
        });
        return url || null;
    }
    catch (e) {
        console.error('guideImagePublicUrl failed', file, e);
        return null;
    }
}
function splitGuideText(text, max = 1900) {
    const parts = [];
    let rest = text.trim();
    while (rest.length > max) {
        let cut = rest.lastIndexOf('\n', max);
        if (cut < 200)
            cut = max;
        parts.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
    }
    if (rest)
        parts.push(rest);
    return parts;
}
async function sendKkScanGuideToKhoGroup(db, sentBy) {
    const chatId = await resolveKhoGroupChatId(db);
    const who = String(sentBy || '').trim().toUpperCase();
    let images = 0;
    for (const img of GUIDE_IMAGES) {
        const buf = loadGuideImageBuffer(img.file);
        if (!(buf === null || buf === void 0 ? void 0 : buf.length)) {
            console.warn('kk-scan-guide: missing image', img.file);
            continue;
        }
        const url = await guideImagePublicUrl(img.file, buf);
        if (!url) {
            console.warn('kk-scan-guide: no public url', img.file);
            continue;
        }
        const ok = await (0, zalo_notify_util_1.sendZaloPhotoByUrl)(chatId, url, img.caption);
        if (ok)
            images += 1;
        else
            console.warn('kk-scan-guide: sendPhoto failed', img.file);
    }
    if (images === 0) {
        throw new Error('Không gửi được hình vào nhóm Quản lý kho. Zalobot chỉ nhận ảnh qua URL (không upload file).');
    }
    const intro = '📘 Hướng dẫn Scan kiểm kê (đọc chậm, làm từng bước).' +
        (who ? `\nNgười gửi: ${who}` : '');
    await (0, zalo_notify_util_1.sendZaloToChat)(chatId, intro);
    for (const part of splitGuideText(exports.KK_SCAN_GUIDE_TEXT)) {
        await (0, zalo_notify_util_1.sendZaloToChat)(chatId, part);
    }
    return { ok: true, images };
}
//# sourceMappingURL=kk-scan-guide-zalo.js.map