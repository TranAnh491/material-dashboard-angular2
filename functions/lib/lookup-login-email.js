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
exports.lookupAuthLoginEmailByEmployeeId = lookupAuthLoginEmailByEmployeeId;
const admin = __importStar(require("firebase-admin"));
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
/**
 * Tìm email đăng nhập Firebase Auth theo mã nhân viên (field employeeId trong users).
 * Dùng khi user đăng ký bằng @airspeedmfgvn.com — không còn trùng với asp####@asp.com.
 */
async function lookupAuthLoginEmailByEmployeeId(employeeIdRaw) {
    const employeeId = normalizeAspEmployeeId(employeeIdRaw);
    if (!employeeId) {
        return null;
    }
    const snap = await admin
        .firestore()
        .collection('users')
        .where('employeeId', '==', employeeId)
        .limit(1)
        .get();
    if (snap.empty) {
        return null;
    }
    const data = snap.docs[0].data();
    const email = typeof data.email === 'string' ? data.email.trim() : '';
    return email ? email.toLowerCase() : null;
}
//# sourceMappingURL=lookup-login-email.js.map