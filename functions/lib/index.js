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
exports.sendControlBatchReportEmail = exports.notifyOutboundDuplicatesAt17 = exports.notifyOutboundDuplicatesAt12 = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const outbound_dup_notify_1 = require("./outbound-dup-notify");
const params_config_1 = require("./params-config");
admin.initializeApp();
/**
 * Control Batch: 12:00 và 17:00 (Asia/Ho_Chi_Minh) quét trùng xuất outbound; có trùng thì gửi email.
 * Secret: EMAIL_PASS — chuỗi: EMAIL_USER, EMAIL_TO, … (xem params-config.ts).
 */
exports.notifyOutboundDuplicatesAt12 = functions
    .runWith({ secrets: [params_config_1.emailPass] })
    .pubsub.schedule('0 12 * * *')
    .timeZone('Asia/Ho_Chi_Minh')
    .onRun(async () => {
    await (0, outbound_dup_notify_1.runOutboundDupNotifyForSlot)(admin.firestore(), '12');
});
exports.notifyOutboundDuplicatesAt17 = functions
    .runWith({ secrets: [params_config_1.emailPass] })
    .pubsub.schedule('0 17 * * *')
    .timeZone('Asia/Ho_Chi_Minh')
    .onRun(async () => {
    await (0, outbound_dup_notify_1.runOutboundDupNotifyForSlot)(admin.firestore(), '17');
});
/** Callable: gửi mail báo cáo trùng xuất tại thời điểm gọi (nút Send Mail — Control Batch). */
exports.sendControlBatchReportEmail = functions
    .runWith({ secrets: [params_config_1.emailPass] })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    try {
        const r = await (0, outbound_dup_notify_1.sendOutboundDupReportManual)(admin.firestore());
        return { ok: true, dupGroups: r.dupGroups };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new functions.https.HttpsError(msg.includes('Thiếu cấu hình') ? 'failed-precondition' : 'internal', msg);
    }
});
//# sourceMappingURL=index.js.map