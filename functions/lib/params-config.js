"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailSmtpPort = exports.emailSmtpHost = exports.emailFrom = exports.emailTo = exports.emailPass = exports.emailUser = void 0;
/**
 * SMTP cho Control Batch (email cảnh báo trùng xuất kho).
 *
 * Bí mật:
 *   firebase functions:secrets:set EMAIL_PASS
 *
 * File local (không commit): functions/.env.<PROJECT_ID>
 *   EMAIL_USER=...
 *   EMAIL_TO=...          # nhiều địa chỉ: a@x.com,b@y.com
 *   EMAIL_FROM=           # để trống = EMAIL_USER
 *   EMAIL_SMTP_HOST=smtp.gmail.com
 *   EMAIL_SMTP_PORT=587
 */
const params_1 = require("firebase-functions/params");
exports.emailUser = (0, params_1.defineString)('EMAIL_USER', { default: '', description: 'SMTP user (e.g. Gmail)' });
exports.emailPass = (0, params_1.defineSecret)('EMAIL_PASS');
exports.emailTo = (0, params_1.defineString)('EMAIL_TO', {
    default: '',
    description: 'Recipients, comma or semicolon separated'
});
exports.emailFrom = (0, params_1.defineString)('EMAIL_FROM', { default: '', description: 'From address; empty = EMAIL_USER' });
exports.emailSmtpHost = (0, params_1.defineString)('EMAIL_SMTP_HOST', { default: 'smtp.gmail.com' });
exports.emailSmtpPort = (0, params_1.defineString)('EMAIL_SMTP_PORT', { default: '587' });
//# sourceMappingURL=params-config.js.map