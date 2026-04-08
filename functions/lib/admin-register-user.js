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
exports.createAspUserAndSendEmail = createAspUserAndSendEmail;
exports.registerAspUserWithEmail = registerAspUserWithEmail;
exports.publicRegisterAspUserWithEmail = publicRegisterAspUserWithEmail;
const admin = __importStar(require("firebase-admin"));
const nodemailer = __importStar(require("nodemailer"));
const params_config_1 = require("./params-config");
function isAdminOrManager(role) {
    const r = (role || '').toString().trim().toLowerCase();
    const normalized = r
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '');
    return (normalized === 'admin' ||
        normalized === 'quan ly' ||
        r === 'admin' ||
        r === 'quản lý');
}
function normalizeAspEmployeeId(input) {
    const t = (input || '').trim().toUpperCase();
    if (!t)
        return null;
    const m1 = t.match(/^ASP(\d{4})$/);
    if (m1)
        return `ASP${m1[1]}`;
    const m2 = t.match(/^(\d{4})$/);
    if (m2)
        return `ASP${m2[1]}`;
    return null;
}
function generateSixDigitPassword() {
    return String(Math.floor(100000 + Math.random() * 900000));
}
function isValidEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
/** Chỉ cho phép đăng ký với email công ty */
function isAllowedRegistrationEmail(email) {
    const e = email.trim().toLowerCase();
    return e.endsWith('@airspeedmfgvn.com') || e.endsWith('@airspeedmfg.com');
}
function esc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
/** Email kho nhận thông báo mỗi khi có tài khoản đăng ký mới (đăng ký công khai hoặc admin). */
const WAREHOUSE_NOTIFY_NEW_REGISTRATION = 'wh1@airspeedmfgvn.com';
async function sendNewRegistrationWarehouseNotify(params) {
    const user = params_config_1.emailUser.value().trim();
    const pass = params_config_1.emailPass.value().trim();
    if (!user || !pass) {
        throw new Error('Thiếu cấu hình SMTP (EMAIL_USER, EMAIL_PASS secret).');
    }
    const host = params_config_1.emailSmtpHost.value().trim() || 'smtp.gmail.com';
    const port = parseInt(params_config_1.emailSmtpPort.value().trim() || '587', 10) || 587;
    const fromRaw = params_config_1.emailFrom.value().trim();
    const from = fromRaw || user;
    const { employeeId, department, registrantEmail, fullName } = params;
    const to = WAREHOUSE_NOTIFY_NEW_REGISTRATION;
    const subject = `[Warehouse] Đăng ký tài khoản mới — ${employeeId}`;
    const text = `Có tài khoản mới được đăng ký.\n\n` +
        `ID đăng nhập (ASP): ${employeeId}\n` +
        `Họ tên: ${fullName || '-'}\n` +
        `Bộ phận: ${department || '-'}\n` +
        `Email nhận mật khẩu: ${registrantEmail}\n`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p>Có tài khoản mới được đăng ký.</p>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px" cellpadding="8" border="1">
<tr><td>ID đăng nhập (ASP)</td><td><strong>${esc(employeeId)}</strong></td></tr>
<tr><td>Họ tên</td><td>${esc(fullName || '-')}</td></tr>
<tr><td>Bộ phận</td><td>${esc(department || '-')}</td></tr>
<tr><td>Email nhận mật khẩu</td><td>${esc(registrantEmail)}</td></tr>
</table>
<p style="color:#555;font-size:12px">Gửi tự động từ hệ thống Warehouse.</p>
</body></html>`;
    const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
    });
    await transporter.sendMail({
        from,
        to,
        subject: subject.slice(0, 250),
        text,
        html
    });
}
async function sendRegistrationEmail(params) {
    const user = params_config_1.emailUser.value().trim();
    const pass = params_config_1.emailPass.value().trim();
    if (!user || !pass) {
        throw new Error('Thiếu cấu hình SMTP (EMAIL_USER, EMAIL_PASS secret).');
    }
    const host = params_config_1.emailSmtpHost.value().trim() || 'smtp.gmail.com';
    const port = parseInt(params_config_1.emailSmtpPort.value().trim() || '587', 10) || 587;
    const fromRaw = params_config_1.emailFrom.value().trim();
    const from = fromRaw || user;
    const { to, employeeId, password, department, fullName } = params;
    const subject = `[Warehouse] Tài khoản đăng ký — ${employeeId}`;
    const text = `Xin chào,\n\n` +
        `Tài khoản ứng dụng kho đã được tạo.\n\n` +
        `Họ tên: ${fullName}\n` +
        `ID đăng nhập (ASP + 4 số): ${employeeId}\n` +
        `Bộ phận: ${department || '-'}\n` +
        `Email này chỉ dùng để nhận thông tin (không nhập ở màn hình đăng nhập): ${to}\n` +
        `Mật khẩu (6 số): ${password}\n\n` +
        `Đăng nhập app: nhập ID ${employeeId} và mật khẩu ở trên (không dùng email để đăng nhập).\n`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p>Xin chào,</p>
<p>Tài khoản ứng dụng kho đã được tạo.</p>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px" cellpadding="8" border="1">
<tr><td>Họ tên</td><td><strong>${esc(fullName)}</strong></td></tr>
<tr><td>ID đăng nhập (ASP + 4 số)</td><td><strong>${esc(employeeId)}</strong></td></tr>
<tr><td>Bộ phận</td><td>${esc(department || '-')}</td></tr>
<tr><td>Email nhận thông tin</td><td>${esc(to)}</td></tr>
<tr><td>Mật khẩu (6 số)</td><td><strong>${esc(password)}</strong></td></tr>
</table>
<p><strong>Đăng nhập app:</strong> nhập ID <strong>${esc(employeeId)}</strong> và mật khẩu ở trên — <em>không</em> dùng email ở màn hình đăng nhập.</p>
<p style="color:#555;font-size:12px">Gửi tự động từ hệ thống Warehouse.</p>
</body></html>`;
    const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
    });
    await transporter.sendMail({
        from,
        to,
        subject: subject.slice(0, 250),
        text,
        html
    });
}
/**
 * Tạo user Auth + Firestore, mật khẩu 6 số, gửi email (dùng chọn cho admin và đăng ký công khai).
 */
async function createAspUserAndSendEmail(employeeIdRaw, departmentRaw, emailRaw, fullNameRaw) {
    const employeeId = normalizeAspEmployeeId(employeeIdRaw);
    if (!employeeId) {
        throw new Error('Mã nhân viên không đúng định dạng (ASPxxxx hoặc xxxx).');
    }
    const fullName = (fullNameRaw || '').trim();
    if (!fullName) {
        throw new Error('Vui lòng nhập họ tên (khác ID đăng nhập ASP).');
    }
    const email = emailRaw.trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
        throw new Error('Email không hợp lệ.');
    }
    if (!isAllowedRegistrationEmail(email)) {
        throw new Error('Email đăng ký phải có đuôi @airspeedmfgvn.com hoặc @airspeedmfg.com.');
    }
    const department = (departmentRaw || '').trim();
    if (!department) {
        throw new Error('Vui lòng chọn bộ phận.');
    }
    const dupEmp = await admin
        .firestore()
        .collection('users')
        .where('employeeId', '==', employeeId)
        .limit(1)
        .get();
    if (!dupEmp.empty) {
        throw new Error(`Mã ${employeeId} đã được đăng ký.`);
    }
    try {
        await admin.auth().getUserByEmail(email);
        throw new Error('Email đã được dùng cho tài khoản khác.');
    }
    catch (e) {
        if ((e === null || e === void 0 ? void 0 : e.code) === 'auth/user-not-found') {
            // email còn trống
        }
        else {
            throw e;
        }
    }
    const password = generateSixDigitPassword();
    const userRecord = await admin.auth().createUser({
        email,
        password,
        displayName: fullName
    });
    const uid = userRecord.uid;
    await admin
        .firestore()
        .collection('users')
        .doc(uid)
        .set({
        uid,
        email,
        employeeId,
        displayName: fullName,
        password,
        department,
        factory: '',
        role: 'User',
        createdAt: new Date(),
        lastLoginAt: new Date(),
        updatedAt: new Date()
    }, { merge: true });
    const defaultTabPerms = { dashboard: true };
    await admin
        .firestore()
        .collection('user-permissions')
        .doc(uid)
        .set({
        uid,
        email,
        displayName: fullName,
        hasDeletePermission: false,
        hasCompletePermission: false,
        hasReadOnlyPermission: true,
        password,
        createdAt: new Date(),
        updatedAt: new Date()
    }, { merge: true });
    await admin
        .firestore()
        .collection('user-tab-permissions')
        .doc(uid)
        .set({
        uid,
        email,
        displayName: fullName,
        tabPermissions: defaultTabPerms,
        createdAt: new Date(),
        updatedAt: new Date()
    }, { merge: true });
    await sendRegistrationEmail({
        to: email,
        employeeId,
        password,
        department,
        fullName
    });
    try {
        await sendNewRegistrationWarehouseNotify({
            employeeId,
            department,
            registrantEmail: email,
            fullName
        });
    }
    catch (e) {
        console.error('sendNewRegistrationWarehouseNotify failed', e);
    }
    return { uid, email, employeeId };
}
/**
 * Admin: đăng ký user (caller phải là Admin/Quản lý).
 */
async function registerAspUserWithEmail(callerUid, employeeIdRaw, departmentRaw, emailRaw, fullNameRaw) {
    var _a;
    if (!callerUid) {
        throw new Error('Thiếu callerUid.');
    }
    const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
    const callerRole = (_a = callerDoc.data()) === null || _a === void 0 ? void 0 : _a.role;
    if (!isAdminOrManager(callerRole)) {
        throw new Error('permission-denied');
    }
    return createAspUserAndSendEmail(employeeIdRaw, departmentRaw, emailRaw, fullNameRaw);
}
/**
 * Đăng ký công khai (trang login) — không kiểm tra admin.
 */
async function publicRegisterAspUserWithEmail(employeeIdRaw, departmentRaw, emailRaw, fullNameRaw) {
    return createAspUserAndSendEmail(employeeIdRaw, departmentRaw, emailRaw, fullNameRaw);
}
//# sourceMappingURL=admin-register-user.js.map