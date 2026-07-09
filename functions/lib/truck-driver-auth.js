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
exports.signInTruckDriver = signInTruckDriver;
const admin = __importStar(require("firebase-admin"));
const XETAI_UID = 'truck-driver-xetai';
const XETAI_EMAIL = 'xetai@asp.com';
const XETAI_EMPLOYEE_ID = 'XETAI';
const XETAI_PASSWORD = '1234';
async function signInTruckDriver(employeeIdRaw, passwordRaw) {
    const employeeId = String(employeeIdRaw || '')
        .trim()
        .toUpperCase();
    const password = String(passwordRaw || '').trim();
    if (employeeId !== XETAI_EMPLOYEE_ID || password !== XETAI_PASSWORD) {
        throw new Error('permission-denied');
    }
    try {
        await admin.auth().getUser(XETAI_UID);
    }
    catch (e) {
        if ((e === null || e === void 0 ? void 0 : e.code) !== 'auth/user-not-found') {
            throw e;
        }
        await admin.auth().createUser({
            uid: XETAI_UID,
            email: XETAI_EMAIL,
            emailVerified: true,
            displayName: 'Tài xế Xe Tải',
            password: 'xetai-1234-driver'
        });
    }
    const now = new Date();
    await admin
        .firestore()
        .collection('users')
        .doc(XETAI_UID)
        .set({
        uid: XETAI_UID,
        email: XETAI_EMAIL,
        employeeId: XETAI_EMPLOYEE_ID,
        displayName: 'Tài xế Xe Tải',
        department: 'LOG',
        factory: 'ALL',
        role: 'User',
        isTruckDriver: true,
        createdAt: now,
        lastLoginAt: now,
        updatedAt: now
    }, { merge: true });
    await admin
        .firestore()
        .collection('user-permissions')
        .doc(XETAI_UID)
        .set({
        uid: XETAI_UID,
        email: XETAI_EMAIL,
        displayName: 'Tài xế Xe Tải',
        hasReadOnlyPermission: true,
        isTruckDriver: true,
        updatedAt: now
    }, { merge: true });
    const token = await admin.auth().createCustomToken(XETAI_UID);
    return { token };
}
//# sourceMappingURL=truck-driver-auth.js.map