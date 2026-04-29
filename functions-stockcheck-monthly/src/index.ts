import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();

/** Stock Check: gộp report theo tháng và lưu ra 1 file (Storage + Firestore link). */
export const generateStockCheckMonthlyReportFn = functions.https.onCall(
  async (data: { factory?: string; year?: number; month?: number }, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const factory = (typeof data?.factory === 'string' ? data.factory.trim().toUpperCase() : 'ASM1') as 'ASM1' | 'ASM2';
    const year = typeof data?.year === 'number' ? data.year : new Date().getFullYear();
    const month = typeof data?.month === 'number' ? data.month : 3;
    if (factory !== 'ASM1' && factory !== 'ASM2') {
      throw new functions.https.HttpsError('invalid-argument', 'Factory không hợp lệ.');
    }
    if (!Number.isFinite(year) || year < 2020 || year > 2100) {
      throw new functions.https.HttpsError('invalid-argument', 'Year không hợp lệ.');
    }
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      throw new functions.https.HttpsError('invalid-argument', 'Month không hợp lệ.');
    }
    try {
      const { generateStockCheckMonthlyReport } = await import('./stock-check-monthly-report');
      return await generateStockCheckMonthlyReport({ factory, year, month });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new functions.https.HttpsError('internal', msg || 'Không tạo được report theo tháng.');
    }
  }
);
