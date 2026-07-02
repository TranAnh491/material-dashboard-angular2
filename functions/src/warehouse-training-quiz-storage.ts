import * as admin from 'firebase-admin';

function safeText(s: unknown, max = 200): string {
  return String(s ?? '').trim().slice(0, max);
}

function decodeImageDataUrl(imageDataUrl: string): Buffer {
  const m = /^data:image\/png;base64,(.+)$/i.exec(imageDataUrl || '');
  if (!m?.[1]) {
    throw new Error('imageDataUrl không hợp lệ (cần data:image/png;base64,...)');
  }
  return Buffer.from(m[1], 'base64');
}

function buildStoragePath(sectionId: string, employeeId: string, fullName: string): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const safeEmp = (employeeId || 'NV').replace(/[^\w-]+/g, '_');
  const safeName = (fullName || 'nhan-vien').replace(/\s+/g, '_').replace(/[^\w-]+/g, '_');
  const fileName = `${yyyy}${mm}${dd}_${hh}${mi}${ss}_${sectionId}_${safeEmp}_${safeName}.png`;
  return `warehouse-training-quiz/${yyyy}-${mm}/${fileName}`.replace(/[^\w./-]/g, '_');
}

async function uploadImageAndGetSignedUrl(buf: Buffer, storagePath: string): Promise<string> {
  const bucket = admin.storage().bucket();
  const file = bucket.file(storagePath);
  await file.save(buf, {
    contentType: 'image/png',
    resumable: false,
    metadata: { cacheControl: 'private, max-age=0, no-transform' }
  });
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 365 * 24 * 60 * 60 * 1000
  });
  return url;
}

export async function saveWarehouseTrainingQuizImage(
  db: admin.firestore.Firestore,
  payload: {
    employeeId?: string;
    fullName?: string;
    joinDate?: string;
    sectionId?: string;
    sectionTitle?: string;
    resultText?: string;
    imageDataUrl: string;
  }
): Promise<{ ok: true; id: string; downloadUrl: string; storagePath: string }> {
  const buf = decodeImageDataUrl(payload.imageDataUrl);
  if (!buf?.length) throw new Error('File hình rỗng');

  const employeeId = safeText(payload.employeeId, 40);
  const fullName = safeText(payload.fullName, 120);
  const joinDate = safeText(payload.joinDate, 40);
  const sectionId = safeText(payload.sectionId, 40);
  const sectionTitle = safeText(payload.sectionTitle, 120);
  const resultText = safeText(payload.resultText, 600);

  const storagePath = buildStoragePath(sectionId, employeeId, fullName);
  const downloadUrl = await uploadImageAndGetSignedUrl(buf, storagePath);

  const docRef = await db.collection('warehouse-training-quiz-results').add({
    fullName,
    employeeId,
    joinDate,
    sectionId,
    sectionTitle,
    resultText,
    storagePath,
    downloadUrl,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { ok: true, id: docRef.id, downloadUrl, storagePath };
}
