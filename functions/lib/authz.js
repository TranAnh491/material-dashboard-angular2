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
exports.ADMIN_EMPLOYEE_ID = void 0;
exports.assertAdmin = assertAdmin;
exports.isAdminAccount = isAdminAccount;
exports.randomSixDigitPassword = randomSixDigitPassword;
exports.sendNewPasswordsToAdminZalo = sendNewPasswordsToAdminZalo;
const admin = __importStar(require("firebase-admin"));
const crypto_1 = require("crypto");
const zalo_notify_util_1 = require("./zalo-notify.util");
/** Admin duy nhất — nhận mật khẩu mới qua Zalo để chuyển cho nhân viên. */
exports.ADMIN_EMPLOYEE_ID = 'ASP0106';
/**
 * Quyền admin chỉ nằm trong custom claim `admin` của Firebase Auth.
 * Client không tự gán được claim, khác với trường `role` / `employeeId` trong Firestore `users`.
 * Gán claim bằng scripts/security-bootstrap-admin.js.
 */
async function assertAdmin(callerUid) {
    var _a;
    if (!callerUid) {
        throw new Error('permission-denied');
    }
    const caller = await admin.auth().getUser(callerUid);
    if (((_a = caller.customClaims) === null || _a === void 0 ? void 0 : _a.admin) !== true) {
        throw new Error('permission-denied');
    }
}
/** Tài khoản admin: không cho đăng nhập bằng quét thẻ, không cho xóa / đổi mật khẩu qua chức năng thường. */
async function isAdminAccount(uid) {
    var _a;
    try {
        const user = await admin.auth().getUser(uid);
        return ((_a = user.customClaims) === null || _a === void 0 ? void 0 : _a.admin) === true;
    }
    catch (_b) {
        return false;
    }
}
/** Mật khẩu 6 số ngẫu nhiên (crypto, không dùng Math.random). */
function randomSixDigitPassword() {
    return String((0, crypto_1.randomInt)(100000, 1000000));
}
/**
 * Gửi mật khẩu mới về Zalo của ASP0106 để chuyển cho nhân viên.
 * Chỉ gửi khi ASP0106 liên kết với ĐÚNG MỘT chat — có hơn một chat nghĩa là liên kết bị chen ngang,
 * không gửi mật khẩu vào đó. Best-effort: lỗi trả về false, không làm hỏng việc đổi mật khẩu.
 * Hàm gọi phải khai báo secret ZALO_BOT_TOKEN trong `runWith({ secrets: [zaloBotToken] })`.
 */
async function sendNewPasswordsToAdminZalo(title, entries) {
    var _a;
    if (!entries.length)
        return true;
    try {
        const links = await admin.firestore().collection('zalo_links')
            .where('memberId', '==', exports.ADMIN_EMPLOYEE_ID)
            .get();
        if (links.size !== 1) {
            console.error(`sendNewPasswordsToAdminZalo: ${exports.ADMIN_EMPLOYEE_ID} có ${links.size} chat Zalo — không gửi mật khẩu.`);
            return false;
        }
        const chatId = String(((_a = links.docs[0].data()) === null || _a === void 0 ? void 0 : _a.chatId) || links.docs[0].id).trim();
        if (!chatId)
            return false;
        const lines = entries.map(e => `${e.employeeId}${e.fullName ? ` — ${e.fullName}` : ''}: ${e.password}`);
        let ok = true;
        for (let i = 0; i < lines.length; i += 25) {
            const part = lines.length > 25 ? ` (${i / 25 + 1}/${Math.ceil(lines.length / 25)})` : '';
            const text = `🔑 ${title}${part}\n${lines.slice(i, i + 25).join('\n')}\n\nChuyển cho nhân viên rồi xóa tin này.`;
            ok = (await (0, zalo_notify_util_1.sendZaloToChat)(chatId, text)) && ok;
        }
        return ok;
    }
    catch (e) {
        console.error('sendNewPasswordsToAdminZalo failed', e);
        return false;
    }
}
//# sourceMappingURL=authz.js.map