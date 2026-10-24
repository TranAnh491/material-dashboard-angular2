import * as admin from 'firebase-admin';

const PREFIX = 'pxk-weight-photos/';
const MAX_AGE_MS = 183 * 24 * 60 * 60 * 1000;

/** Xóa JPEG bag lẻ đã cân quá 6 tháng. */
export async function runPxkWeightPhotoPurgeJob(): Promise<{ scanned: number; deleted: number }> {
  const bucket = admin.storage().bucket();
  const cutoff = Date.now() - MAX_AGE_MS;
  const [files] = await bucket.getFiles({ prefix: PREFIX });
  let deleted = 0;
  for (const file of files) {
    const created = Date.parse(String(file.metadata?.timeCreated || ''));
    if (!created || created >= cutoff) continue;
    await file.delete({ ignoreNotFound: true });
    deleted++;
  }
  console.log(`[pxk-weight-photos] scanned=${files.length} deleted=${deleted}`);
  return { scanned: files.length, deleted };
}
