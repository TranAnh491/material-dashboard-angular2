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
exports.toTruckAuthPassword = toTruckAuthPassword;
exports.signInTruckDriver = signInTruckDriver;
const admin = __importStar(require("firebase-admin"));
/** Tài khoản app phụ Xe Tải — đăng nhập bằng mã ASP hoặc XETAI, mật khẩu 123456. */
const TRUCK_DRIVER_ACCOUNTS = {
    ASP9999: {
        uid: 'truck-driver-asp9999',
        email: 'asp9999@asp.com',
        employeeId: 'ASP9999',
        password: '123456',
        displayName: 'Tài xế Xe Tải'
    },
    XETAI: {
        uid: 'truck-driver-xetai',
        email: 'xetai@asp.com',
        employeeId: 'XETAI',
        password: '123456',
        displayName: 'Tài xế Xe Tải'
    }
};
/** Firebase Auth yêu cầu mật khẩu >= 6 ký tự. */
function toTruckAuthPassword(password) {
    const p = String(password || '').trim();
    if (p.length >= 6)
        return p;
    return p.padEnd(6, '0');
}
async function ensureTruckDriverAuthUser(account) {
    const auth = admin.auth();
    const authPassword = toTruckAuthPassword(account.password);
    const applyUpdate = async (uid) => {
        await auth.updateUser(uid, {
            email: account.email,
            emailVerified: true,
            displayName: account.displayName,
            password: authPassword
        });
    };
    try {
        await auth.getUser(account.uid);
        try {
            await applyUpdate(account.uid);
            return account.uid;
        }
        catch (e) {
            if ((e === null || e === void 0 ? void 0 : e.code) !== 'auth/email-already-exists') {
                throw e;
            }
        }
    }
    catch (e) {
        if ((e === null || e === void 0 ? void 0 : e.code) !== 'auth/user-not-found') {
            throw e;
        }
    }
    try {
        const byEmail = await auth.getUserByEmail(account.email);
        await auth.updateUser(byEmail.uid, {
            emailVerified: true,
            displayName: account.displayName,
            password: authPassword
        });
        return byEmail.uid;
    }
    catch (e) {
        if ((e === null || e === void 0 ? void 0 : e.code) !== 'auth/user-not-found') {
            throw e;
        }
    }
    await auth.createUser({
        uid: account.uid,
        email: account.email,
        emailVerified: true,
        displayName: account.displayName,
        password: authPassword
    });
    return account.uid;
}
async function ensureTruckDriverFirestore(account, uid) {
    const now = new Date();
    await admin
        .firestore()
        .collection('users')
        .doc(uid)
        .set({
        uid,
        email: account.email,
        employeeId: account.employeeId,
        displayName: account.displayName,
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
        .doc(uid)
        .set({
        uid,
        email: account.email,
        displayName: account.displayName,
        hasReadOnlyPermission: true,
        isTruckDriver: true,
        updatedAt: now
    }, { merge: true });
}
async function signInTruckDriver(employeeIdRaw, passwordRaw) {
    const employeeId = String(employeeIdRaw || '')
        .trim()
        .toUpperCase();
    const password = String(passwordRaw || '').trim();
    const account = TRUCK_DRIVER_ACCOUNTS[employeeId];
    if (!account || password !== account.password) {
        throw new Error('permission-denied');
    }
    const uid = await ensureTruckDriverAuthUser(account);
    await ensureTruckDriverFirestore(account, uid);
    return {
        email: account.email,
        authPassword: toTruckAuthPassword(account.password)
    };
}
//# sourceMappingURL=truck-driver-auth.js.map