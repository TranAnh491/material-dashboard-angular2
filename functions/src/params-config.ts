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
 *   QC_PRIORITY_EMAIL_TO=plan4@airspeedmfgvn.com   (mail khi ưu tiên Chờ kiểm: CHỜ KIỂM → trạng thái khác)
 */
import { defineSecret, defineString } from 'firebase-functions/params';

export const emailUser = defineString('EMAIL_USER', { default: '', description: 'SMTP user (e.g. Gmail)' });
export const emailPass = defineSecret('EMAIL_PASS');
export const emailTo = defineString('EMAIL_TO', {
  default: '',
  description: 'Recipients, comma or semicolon separated'
});
export const emailFrom = defineString('EMAIL_FROM', { default: '', description: 'From address; empty = EMAIL_USER' });
export const emailSmtpHost = defineString('EMAIL_SMTP_HOST', { default: 'smtp.gmail.com' });
export const emailSmtpPort = defineString('EMAIL_SMTP_PORT', { default: '587' });

/**
 * Zalo Bot Platform token (dùng để gửi tin nhắn bot).
 * Bí mật:
 *   firebase functions:secrets:set ZALO_BOT_TOKEN
 */
export const zaloBotToken = defineSecret('ZALO_BOT_TOKEN');

/** Tab QC: ưu tiên Chờ kiểm, đổi từ CHỜ KIỂM sang trạng thái khác */
export const qcPriorityEmailTo = defineString('QC_PRIORITY_EMAIL_TO', {
  default: 'ASM1-Planning@airspeedmfg.com',
  description: 'Email nhận thông báo mã QC ưu tiên đã xử lý'
});

/** Tab QC: report tháng (ASM1) */
export const qcMonthlyReportEmailTo = defineString('QC_MONTHLY_REPORT_EMAIL_TO', {
  default: 'asm1-quality@airspeedmfg.com',
  description: 'Email nhận QC monthly report (ASM1)'
});
