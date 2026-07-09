import * as admin from 'firebase-admin';

const FG_BACKUP_ROOT = 'fg-daily-backups';
const CHUNK_SIZE = 250;

const COLLECTIONS: Array<{ key: string; source: string }> = [
  { key: 'fg-inventory', source: 'fg-inventory' },
  { key: 'fg-in', source: 'fg-in' },
  { key: 'fg-out', source: 'fg-out' },
  { key: 'fg-check', source: 'fg-check' }
];

function formatYmdInTz(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value || '1970';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const d = parts.find((p) => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatYmdInTz(dt);
}

async function backupCollection(db: admin.firestore.Firestore, key: string, source: string, dayYmd: string): Promise<number> {
  const dayKey = Number(dayYmd.replace(/-/g, '')) || 0;
  const dayRef = db.collection(FG_BACKUP_ROOT).doc(key).collection('days').doc(String(dayKey));

  const existing = await dayRef.get();
  if (existing.exists) {
    return Number(existing.data()?.itemCount || 0) || 0;
  }

  const snap = await db.collection(source).get();
  const items = snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));

  const chunkCount = Math.max(1, Math.ceil(items.length / CHUNK_SIZE));
  const chunksCol = dayRef.collection('chunks');

  await dayRef.set({
    collectionKey: key,
    dayKey,
    dateYmd: dayYmd,
    itemCount: items.length,
    chunkCount,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  for (let i = 0; i < chunkCount; i++) {
    const slice = items.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    await chunksCol.doc(String(i).padStart(3, '0')).set({ index: i, items: slice });
  }

  return items.length;
}

/** Backup cuối ngày hôm qua (VN) cho các collection FG. */
export async function runFgDailyBackupJob(): Promise<void> {
  const db = admin.firestore();
  const backupYmd = shiftYmd(formatYmdInTz(new Date()), -1);

  for (const cfg of COLLECTIONS) {
    const count = await backupCollection(db, cfg.key, cfg.source, backupYmd);
    console.log(`[fg-daily-backup] ${cfg.key} ${backupYmd}: ${count} items`);
  }
}
