import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { zaloBotToken } from './params-config';

admin.initializeApp();

/** LSX → Kitting + chưa có người soạn → Zalo người quét outbound gần nhất. */
export const onWorkOrderKittingNotifyZalo = functions
  .runWith({ secrets: [zaloBotToken] })
  .firestore.document('work-orders/{woId}')
  .onUpdate(async (change, context) => {
    const before = (change.before.data() || {}) as Record<string, unknown>;
    const after = (change.after.data() || {}) as Record<string, unknown>;
    const woId = context.params.woId as string;
    try {
      const { handleWorkOrderKittingZaloNotify } = await import('./work-order-kitting-zalo');
      await handleWorkOrderKittingZaloNotify(admin.firestore(), before, after, woId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('onWorkOrderKittingNotifyZalo failed', woId, msg);
    }
  });
