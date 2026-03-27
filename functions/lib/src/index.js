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
exports.updateUserPasswordAdmin = exports.placeholder = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
admin.initializeApp();
exports.placeholder = functions.https.onRequest((req, res) => {
    res.status(200).send('OK');
});
/**
 * Admin password reset for a target Firebase Auth user.
 * NOTE: this is intentionally callable from Settings client flow.
 */
exports.updateUserPasswordAdmin = functions.https.onCall(async (data, context) => {
    var _a;
    try {
        const uid = ((data === null || data === void 0 ? void 0 : data.uid) || '').toString().trim();
        const newPassword = ((data === null || data === void 0 ? void 0 : data.newPassword) || '').toString();
        if (!uid) {
            throw new functions.https.HttpsError('invalid-argument', 'Missing target uid');
        }
        if (!newPassword || newPassword.length < 6) {
            throw new functions.https.HttpsError('invalid-argument', 'Password must be at least 6 characters');
        }
        // Optional guard: require caller to be authenticated
        if (!((_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid)) {
            throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
        }
        await admin.auth().updateUser(uid, { password: newPassword });
        return { success: true };
    }
    catch (err) {
        console.error('updateUserPasswordAdmin error:', err);
        if (err instanceof functions.https.HttpsError)
            throw err;
        throw new functions.https.HttpsError('internal', (err === null || err === void 0 ? void 0 : err.message) || 'Failed to update password');
    }
});
//# sourceMappingURL=index.js.map