import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';
import { resolveControlBatchOutboundRowBagFields } from './outbound-bag-resolve';
import {
  emailFrom,
  emailPass,
  emailSmtpHost,
  emailSmtpPort,
  emailTo,
  emailUser,
  zaloBotToken
} from './params-config';

const CONTROL_BATCH_EXCLUSION_COLLECTION = 'control-batch-exclusion';
const CONTROL_BATCH_EXCLUSION_DOC = 'settings';

/** Mặc định: 02/04/2026 00:00 (VN), lưu dạng YYYY-MM-DD trên Firestore. */
export const DEFAULT_OUTBOUND_DUP_SINCE_YMD = '2026-04-02';

export type ControlBatchExclusion = {
  enabled: boolean;
  codes: Set<string>;
};

/** Cấu hình quét trùng: loại trừ + mốc ngày bắt đầu tính (00:00 VN). */
export type ControlBatchDupSettings = {
  exclusion: ControlBatchExclusion;
  dupSinceMs: number;
  dupSinceYmd: string;
  /** DD/MM/YYYY — hiển thị email / đồng bộ với app. */
  dupSinceLabel: string;
  /** Nhóm trùng bị bỏ qua theo baseline count (key -> ignoredCount). */
  ignoredGroups: Map<string, number>;
  /** Nhóm trùng đã gửi email (key -> true). */
  emailedGroups: Set<string>;
};

/** 00:00 ngày `ymd` theo múi Asia/Ho_Chi_Minh. */
export function vnYmdStartMs(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) {
    return null;
  }
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00+07:00`);
  return Number.isNaN(t) ? null : t;
}

function formatYmdVnDisplay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) {
    return ymd.trim();
  }
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function normalizeOutboundDupSinceYmd(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && vnYmdStartMs(s) != null) {
    return s;
  }
  return DEFAULT_OUTBOUND_DUP_SINCE_YMD;
}

const CONTROL_BATCH_EXCLUDE_PREFIX_LEN = 4;

/**
 * Mục danh mục đúng 4 ký tự = tiền tố (vd. B034 → loại B034001, B034xxx…).
 * Khác = khớp nguyên mã. Đồng bộ với tab Control Batch (Angular).
 */
export function isMaterialCodeExcludedByControlBatchRules(mcNorm: string, rules: Set<string>): boolean {
  const mc = String(mcNorm || '').trim().toUpperCase();
  if (!mc) {
    return false;
  }
  for (const rule of rules) {
    const ex = String(rule || '').trim().toUpperCase();
    if (!ex) {
      continue;
    }
    if (ex.length === CONTROL_BATCH_EXCLUDE_PREFIX_LEN) {
      if (mc.startsWith(ex)) {
        return true;
      }
    } else if (mc === ex) {
      return true;
    }
  }
  return false;
}

/** Đọc `control-batch-exclusion/settings` (loại trừ + outboundDupSinceDate). */
/**
 * Payload từ app (bag-history — Send Mail): cùng nguồn với bảng lọc trùng.
 * Nếu thiếu/invalid → trả null (Functions sẽ đọc Firestore như trước).
 */
export function buildControlBatchDupSettingsFromCallablePayload(data: unknown): ControlBatchDupSettings | null {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const d = data as Record<string, unknown>;
  const ymdRaw = d['outboundDupSinceDate'];
  if (typeof ymdRaw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymdRaw.trim())) {
    return null;
  }
  const dupSinceYmd = normalizeOutboundDupSinceYmd(ymdRaw);
  const dupSinceMs = vnYmdStartMs(dupSinceYmd);
  if (dupSinceMs == null) {
    return null;
  }
  const enabled = d['excludeEnabled'] === true;
  const raw = d['excludeMaterialCodes'];
  const arr = Array.isArray(raw) ? raw : [];
  const codes = new Set<string>();
  for (const x of arr) {
    const c = String(x || '').trim().toUpperCase();
    if (c) {
      codes.add(c);
    }
  }

  // Optional: allow app to pass ignored groups so manual Send Mail matches UI exactly
  const ignoredGroups = new Map<string, number>();
  const rawIgnored = d['outboundDupIgnoredGroups'];
  if (Array.isArray(rawIgnored)) {
    for (const item of rawIgnored as any[]) {
      const key = String(item?.key ?? '').trim();
      const n = Number(item?.ignoredCount);
      if (!key) continue;
      if (Number.isFinite(n) && n > 0) ignoredGroups.set(key, Math.floor(n));
    }
  }
  return {
    exclusion: { enabled, codes },
    dupSinceMs,
    dupSinceYmd,
    dupSinceLabel: formatYmdVnDisplay(dupSinceYmd),
    ignoredGroups,
    emailedGroups: new Set<string>()
  };
}

export async function loadControlBatchDupSettings(
  db: admin.firestore.Firestore
): Promise<ControlBatchDupSettings> {
  const snap = await db.collection(CONTROL_BATCH_EXCLUSION_COLLECTION).doc(CONTROL_BATCH_EXCLUSION_DOC).get();
  const d = snap.data() || {};
  const enabled = d.excludeEnabled === true;
  const arr = Array.isArray(d.excludeMaterialCodes) ? d.excludeMaterialCodes : [];
  const codes = new Set<string>();
  for (const x of arr) {
    const c = String(x || '').trim().toUpperCase();
    if (c) {
      codes.add(c);
    }
  }
  const dupSinceYmd = normalizeOutboundDupSinceYmd(d.outboundDupSinceDate);
  const dupSinceMs = vnYmdStartMs(dupSinceYmd)!;
  const ignoredGroups = new Map<string, number>();
  if (Array.isArray(d.outboundDupIgnoredGroups)) {
    for (const item of d.outboundDupIgnoredGroups) {
      const key = String(item?.key ?? '').trim();
      const n = Number(item?.ignoredCount);
      if (!key) continue;
      if (Number.isFinite(n) && n > 0) ignoredGroups.set(key, Math.floor(n));
    }
  }
  const emailedGroups = new Set<string>();
  if (Array.isArray(d.outboundDupEmailedGroups)) {
    for (const item of d.outboundDupEmailedGroups) {
      const key = String(item?.key ?? '').trim();
      if (key) emailedGroups.add(key);
    }
  }
  return {
    exclusion: { enabled, codes },
    dupSinceMs,
    dupSinceYmd,
    dupSinceLabel: formatYmdVnDisplay(dupSinceYmd),
    ignoredGroups,
    emailedGroups
  };
}

export type OutboundDupRow = {
  factory: string;
  materialCode: string;
  poNumber: string;
  imd: string;
  /** Bịch (i/tổng) — nguồn: field `bagBatch` trên outbound-materials */
  bagBatch: string;
  /** Bag: `i` hoặc `i(T...)` khi bịch tách/lẻ; fallback lấy `i` từ bịch i/tổng */
  bagNumberDisplay?: string;
  /** Latest export time ms, for sorting like UI */
  latestExportAtMs?: number;
  /** Latest export time label (VN), for display parity */
  latestExportAtLabel?: string;
  /** First LSX (A-Z), for sorting like UI */
  productionOrderFirst?: string;
  count: number;
  productionOrderSummary: string;
  /** composite key factory|mc|po|imd|bich|bag */
  dupKey: string;
};

type Agg = {
  count: number;
  sample: Pick<OutboundDupRow, 'factory' | 'materialCode' | 'poNumber' | 'imd' | 'bagBatch' | 'bagNumberDisplay'>;
  lsx: Set<string>;
  latestMs: number;
};

function isValidRmMaterialCode(code: string): boolean {
  const c = (code || '').trim().toUpperCase();
  return /^[AB]\d{6}$/.test(c);
}

function isValidOutboundPo(po: string): boolean {
  const p = (po || '').trim();
  if (!p || !/[A-Za-z]/.test(p)) {
    return false;
  }
  const u = p.toUpperCase();
  return u.startsWith('KZ') || u.startsWith('LH');
}

function stringHasDigit(s: string): boolean {
  return /\d/.test(String(s || ''));
}

function isOutboundRowEligible(
  materialCode: string,
  poNumber: string,
  imd: string,
  bagBatch: string
): boolean {
  const mc = (materialCode || '').trim().toUpperCase();
  if (!isValidRmMaterialCode(mc)) {
    return false;
  }
  if (!isValidOutboundPo(poNumber)) {
    return false;
  }
  if (!stringHasDigit(imd)) {
    return false;
  }
  if (!stringHasDigit(bagBatch)) {
    return false;
  }
  return true;
}

function docTimeMs(data: admin.firestore.DocumentData): number | null {
  const tryOne = (v: unknown): number | null => {
    if (v == null) {
      return null;
    }
    if (v instanceof admin.firestore.Timestamp) {
      return v.toMillis();
    }
    if (v instanceof Date) {
      const t = v.getTime();
      return Number.isNaN(t) ? null : t;
    }
    return null;
  };
  return tryOne(data.exportDate) ?? tryOne(data.createdAt) ?? tryOne(data.updatedAt);
}

function isOnOrAfterDupSince(data: admin.firestore.DocumentData, sinceMs: number): boolean {
  const t = docTimeMs(data);
  if (t == null) {
    return false;
  }
  return t >= sinceMs;
}

function compositeKey(
  factory: string,
  materialCode: string,
  poNumber: string,
  imd: string,
  bichBatch: string,
  bagDisplay: string
): string {
  const fac = (factory || '').trim();
  const mc = (materialCode || '').trim().toUpperCase();
  const po = (poNumber || '').trim();
  const im = (imd || '').trim();
  const bich = (bichBatch || '').trim();
  const bag = (bagDisplay || '').trim();
  return `${fac}|${mc}|${po}|${im}|${bich}|${bag}`;
}

async function fetchAllOutboundByFactory(
  db: admin.firestore.Firestore,
  factory: string
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const ref = db.collection('outbound-materials');
  const batchSize = 500;
  const idPath = admin.firestore.FieldPath.documentId();
  const out: admin.firestore.QueryDocumentSnapshot[] = [];
  let last: admin.firestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let q: admin.firestore.Query = ref.where('factory', '==', factory).orderBy(idPath).limit(batchSize);
    if (last) {
      q = q.startAfter(last);
    }
    const snap = await q.get();
    if (snap.empty) {
      break;
    }
    out.push(...snap.docs);
    if (snap.docs.length < batchSize) {
      break;
    }
    last = snap.docs[snap.docs.length - 1];
  }
  return out;
}

/** Cùng logic với tab Control Batch (Angular). */
export async function scanOutboundDuplicates(
  db: admin.firestore.Firestore,
  cached?: ControlBatchDupSettings
): Promise<OutboundDupRow[]> {
  const s = cached ?? (await loadControlBatchDupSettings(db));
  const excl = s.exclusion;
  const [docs1, docs2] = await Promise.all([
    fetchAllOutboundByFactory(db, 'ASM1'),
    fetchAllOutboundByFactory(db, 'ASM2')
  ]);
  const all = [...docs1, ...docs2];
  const counts = new Map<string, Agg>();

  for (const doc of all) {
    const d = doc.data();
    if (!isOnOrAfterDupSince(d, s.dupSinceMs)) {
      continue;
    }
    const factory = String(d.factory ?? '');
    const materialCode = String(d.materialCode ?? '');
    const poNumber = String(d.poNumber ?? '');
    const imdRaw = d.batchNumber ?? d.importDate;
    const imd = imdRaw != null ? String(imdRaw) : '';
    const { bichBatch, bagDisplay, eligibleForDupScan } = resolveControlBatchOutboundRowBagFields(
      d as Record<string, unknown>
    );
    if (!eligibleForDupScan) {
      continue;
    }

    // Eligible: cần có số ở IMD, Bịch, Bag
    if (!isOutboundRowEligible(materialCode, poNumber, imd, `${bichBatch} ${bagDisplay}`)) {
      continue;
    }

    const mcNorm = materialCode.trim().toUpperCase();
    if (excl.enabled && isMaterialCodeExcludedByControlBatchRules(mcNorm, excl.codes)) {
      continue;
    }

    const key = compositeKey(factory, materialCode, poNumber, imd, bichBatch, bagDisplay);
    const lsxVal = d.productionOrder;
    const lsxStr = lsxVal != null ? String(lsxVal).trim() : '';
    const tMs = docTimeMs(d) ?? 0;
    const prev = counts.get(key);
    if (prev) {
      prev.count += 1;
      if (tMs > prev.latestMs) prev.latestMs = tMs;
      if (lsxStr) {
        prev.lsx.add(lsxStr);
      }
    } else {
      const lsx = new Set<string>();
      if (lsxStr) {
        lsx.add(lsxStr);
      }
      counts.set(key, {
        count: 1,
        sample: {
          factory: factory.trim(),
          materialCode: materialCode.trim(),
          poNumber: poNumber.trim(),
          imd: imd.trim(),
          bagBatch: bichBatch.trim(),
          bagNumberDisplay: bagDisplay.trim()
        },
        lsx,
        latestMs: tMs
      });
    }
  }

  const dupes: OutboundDupRow[] = [];
  const fmtVn = (ms: number): string => {
    if (!ms) return '';
    const dt = new Date(ms);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
  };
  for (const { count, sample, lsx, latestMs } of counts.values()) {
    if (count > 1) {
      const lsxList = Array.from(lsx).sort((a, b) => a.localeCompare(b, 'vi'));
      const productionOrderSummary = lsxList.length > 0 ? lsxList.join(' · ') : '—';
      const dupKey = compositeKey(
        sample.factory,
        sample.materialCode,
        sample.poNumber,
        sample.imd,
        sample.bagBatch,
        String((sample as any).bagNumberDisplay ?? '')
      );
      const ignoredBaseline = s.ignoredGroups.get(dupKey);
      if (ignoredBaseline != null && ignoredBaseline >= count) {
        continue;
      }
      dupes.push({
        ...sample,
        latestExportAtMs: latestMs || 0,
        latestExportAtLabel: fmtVn(latestMs) || undefined,
        productionOrderFirst: lsxList?.[0] || '',
        count,
        productionOrderSummary,
        dupKey
      });
    }
  }
  // Sort parity with UI: date desc → LSX A-Z → mã A-Z
  dupes.sort((a, b) => {
    const tA = Number(a.latestExportAtMs || 0);
    const tB = Number(b.latestExportAtMs || 0);
    if (tA !== tB) return tB - tA;
    const lsxA = String(a.productionOrderFirst || a.productionOrderSummary || '').toUpperCase();
    const lsxB = String(b.productionOrderFirst || b.productionOrderSummary || '').toUpperCase();
    const lc = lsxA.localeCompare(lsxB, 'vi');
    if (lc !== 0) return lc;
    const mcA = String(a.materialCode || '').toUpperCase();
    const mcB = String(b.materialCode || '').toUpperCase();
    const mc = mcA.localeCompare(mcB, 'vi');
    if (mc !== 0) return mc;
    // tie-breaker stable
    const fc = String(a.factory || '').localeCompare(String(b.factory || ''), 'vi');
    if (fc !== 0) return fc;
    const po = String(a.poNumber || '').localeCompare(String(b.poNumber || ''), 'vi');
    if (po !== 0) return po;
    const im = String(a.imd || '').localeCompare(String(b.imd || ''), 'vi');
    if (im !== 0) return im;
    const bb = String(a.bagBatch || '').localeCompare(String(b.bagBatch || ''), 'vi');
    if (bb !== 0) return bb;
    return String(a.bagNumberDisplay || '').localeCompare(String(b.bagNumberDisplay || ''), 'vi');
  });
  return dupes;
}

type EmailCfg = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  to: string[];
};

function getEmailCfg(): EmailCfg | null {
  const user = emailUser.value().trim();
  const pass = emailPass.value().trim();
  const toRaw = emailTo.value().trim();
  const to = toRaw
    .split(/[,;]/)
    .map(s => s.trim())
    .filter(Boolean);
  if (!user || !pass || to.length === 0) {
    return null;
  }
  const host = emailSmtpHost.value().trim() || 'smtp.gmail.com';
  const port = parseInt(emailSmtpPort.value().trim() || '587', 10) || 587;
  const fromRaw = emailFrom.value().trim();
  const from = fromRaw || user;
  return { host, port, user, pass, from, to };
}

function buildPlainText(dupes: OutboundDupRow[], dupSinceLabel: string, exclusionNote?: string): string {
  const lines = dupes.map(
    r =>
      `- ${r.factory} | ${r.materialCode} | PO ${r.poNumber} | IMD ${r.imd || '—'} | Bịch ${r.bagBatch || '—'} | Bag ${r.bagNumberDisplay || '—'} | ${r.count} lần | LSX: ${r.productionOrderSummary} | Ngày: ${r.latestExportAtLabel || '—'}`
  );
  return (
    `Control Batch — phát hiện ${dupes.length} nhóm trùng xuất kho (từ ${dupSinceLabel}, đủ điều kiện định dạng).\n\n` +
    lines.join('\n') +
    (exclusionNote ? `\n\n${exclusionNote}` : '')
  );
}

function buildHtml(dupes: OutboundDupRow[], dupSinceLabel: string, exclusionNoteHtml?: string): string {
  const rows = dupes
    .map(
      r =>
        `<tr><td>${esc(r.factory)}</td><td>${esc(r.materialCode)}</td><td>${esc(r.poNumber)}</td><td>${esc(r.imd)}</td><td>${esc(r.bagBatch || '')}</td><td>${esc(r.bagNumberDisplay || '')}</td><td style="text-align:right">${r.count}</td><td>${esc(r.productionOrderSummary)}</td><td>${esc(r.latestExportAtLabel || '')}</td></tr>`
    )
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p><strong>Control Batch</strong> — ${dupes.length} nhóm <strong>trùng xuất kho</strong> (từ ${esc(dupSinceLabel)}).</p>
${exclusionNoteHtml || ''}
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:13px">
<thead><tr><th>Nhà máy</th><th>Mã</th><th>PO</th><th>IMD</th><th>Bịch</th><th>Bag</th><th>Số lần</th><th>Lệnh SX</th><th>Ngày</th></tr></thead>
<tbody>${rows}</tbody></table>
<p style="color:#555;font-size:12px">Gửi từ Tuấn Anh</p>
</body></html>`;
}

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendDupEmail(
  dupes: OutboundDupRow[],
  cfg: EmailCfg,
  settings: ControlBatchDupSettings
): Promise<void> {
  const exclusion = settings.exclusion;
  const exclNote =
    exclusion.enabled && exclusion.codes.size > 0
      ? `Đang bật loại trừ: ${exclusion.codes.size} dòng danh mục (mã đủ hoặc 4 ký tự = tiền tố nhóm).`
      : exclusion.enabled
        ? 'Đang bật loại trừ (danh sách mã trống).'
        : '';
  const exclHtml =
    exclNote !== ''
      ? `<p style="color:#1565c0;font-size:13px"><strong>Ghi chú:</strong> ${esc(exclNote)}</p>`
      : '';
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass }
  });
  await transporter.sendMail({
    from: cfg.from,
    to: cfg.to.join(', '),
    subject: `[Control Batch] Cảnh báo: ${dupes.length} nhóm trùng xuất kho (mới)`,
    text: buildPlainText(dupes, settings.dupSinceLabel, exclNote || undefined),
    html: buildHtml(dupes, settings.dupSinceLabel, exclHtml || undefined)
  });
}

async function sendZaloDupNotify(
  db: admin.firestore.Firestore,
  dupes: OutboundDupRow[],
  settings?: Pick<ControlBatchDupSettings, 'dupSinceLabel' | 'exclusion'>
): Promise<{ ok: boolean; reason?: string }> {
  const token = zaloBotToken.value().trim();
  if (!token) {
    console.error('outbound-dup-notify-30m: missing ZALO_BOT_TOKEN');
    return { ok: false, reason: 'missing_token' };
  }

  // Fixed recipients requested: ASP0106 & ASP0701 (lookup chatId from `zalo_links`)
  const memberIds = ['ASP0106', 'ASP0701'];
  const links = await db
    .collection('zalo_links')
    .where('memberId', 'in', memberIds)
    .get()
    .catch(e => {
      console.error('outbound-dup-notify-30m: lookup zalo_links failed', e);
      return null;
    });

  const chatIds: string[] = [];
  if (links && !links.empty) {
    for (const doc of links.docs) {
      const d = doc.data() as any;
      const chatId = typeof d?.chatId === 'string' ? d.chatId.trim() : '';
      if (chatId) chatIds.push(chatId);
    }
  }

  if (chatIds.length === 0) {
    console.warn('outbound-dup-notify-30m: no chatId for', memberIds);
    return { ok: false, reason: 'missing_chatId' };
  }

  const url = `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/sendMessage`;
  const top = dupes.slice(0, 8);
  const lines = top.map(r => {
    const fac = r.factory || '';
    const mc = (r.materialCode || '').toUpperCase();
    const po = r.poNumber ? ` PO:${r.poNumber}` : '';
    const imd = r.imd ? ` IMD:${r.imd}` : '';
    const bagDisp = (r.bagNumberDisplay || r.bagBatch || '').trim();
    const bag = bagDisp ? ` BAG:${bagDisp}` : '';
    const lsx = r.productionOrderFirst || r.productionOrderSummary;
    const lsxPart = lsx && lsx !== '—' ? ` LSX:${lsx}` : '';
    const dt = r.latestExportAtLabel ? ` NGÀY:${r.latestExportAtLabel}` : '';
    return `- ${fac} ${mc}${po}${imd}${bag}${lsxPart}${dt} (${r.count})`;
  });
  const since = settings?.dupSinceLabel ? `\nTừ ngày: ${settings.dupSinceLabel}` : '';
  const excl =
    settings?.exclusion?.enabled === true
      ? `\nLoại trừ: BẬT (${settings.exclusion.codes?.size ?? 0} dòng)`
      : settings?.exclusion
        ? `\nLoại trừ: TẮT`
        : '';
  const msg =
    `⚠️ Control Batch: phát hiện ${dupes.length} nhóm trùng xuất kho (mới).` +
    since +
    excl +
    `\n` +
    lines.join('\n') +
    (dupes.length > top.length ? `\n... +${dupes.length - top.length} nhóm` : '');

  try {
    await Promise.all(
      chatIds.map(chatId =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: msg })
        })
      )
    );
    return { ok: true };
  } catch (e) {
    console.error('outbound-dup-notify-30m: send zalo failed', e);
    return { ok: false, reason: 'send_failed' };
  }
}

function vnNowLabel(d = new Date()): string {
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

function vnFiveMinBucketKey(d = new Date()): string {
  const vn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const y = vn.getUTCFullYear();
  const m = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const day = String(vn.getUTCDate()).padStart(2, '0');
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const min = vn.getUTCMinutes();
  const mm = String(Math.floor(min / 5) * 5).padStart(2, '0');
  return `${y}-${m}-${day}-${hh}:${mm}`;
}

/**
 * Lịch 5 phút (theo khung giờ): nếu phát sinh nhóm trùng "mới" thì gửi Zalo.
 * "Mới" = dupKey chưa từng được gửi trước đây (outboundDupEmailedGroups).
 * Nhóm đã gửi sẽ không gửi lại.
 */
export async function runOutboundDupNotifyEvery30Min(db: admin.firestore.Firestore): Promise<void> {
  const bucket = vnFiveMinBucketKey(new Date());
  const lockRef = db.collection('outbound-dup-notify-locks').doc(`5m-${bucket}`);

  const canProceed = await db.runTransaction(async tx => {
    const snap = await tx.get(lockRef);
    if (snap.exists) {
      const st = (snap.data() as { status?: string })?.status;
      if (st === 'done' || st === 'sending') return false;
    }
    tx.set(
      lockRef,
      { status: 'sending', bucket, startedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    return true;
  });
  if (!canProceed) {
    console.log('outbound-dup-notify-5m: skip (lock)', bucket);
    return;
  }

  try {
    const settings = await loadControlBatchDupSettings(db);
    const allDupes = await scanOutboundDuplicates(db, settings);
    const newDupes = allDupes.filter(r => !settings.emailedGroups.has(r.dupKey));

    if (newDupes.length === 0) {
      await lockRef.set(
        {
          status: 'done',
          dupGroups: 0,
          emailSent: false,
          zaloSent: false,
          finishedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      return;
    }

    // Send Zalo only (email disabled by request).
    const zalo = await sendZaloDupNotify(db, newDupes, {
      dupSinceLabel: settings.dupSinceLabel,
      exclusion: settings.exclusion
    });
    const zaloSent = zalo.ok;
    const emailSent = false;

    // IMPORTANT: only mark as "sent" when Zalo actually sent.
    // Otherwise, if token/chatId missing, we'd permanently suppress future notifications.
    if (zaloSent) {
      const sentAt = vnNowLabel(new Date());
      const toAppend = newDupes.map(r => ({ key: r.dupKey, sentAt }));
      const settingsRef = db.collection(CONTROL_BATCH_EXCLUSION_COLLECTION).doc(CONTROL_BATCH_EXCLUSION_DOC);
      await settingsRef.set(
        {
          outboundDupEmailedGroups: admin.firestore.FieldValue.arrayUnion(...toAppend),
          outboundDupLastAutoEmailAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    }

    await lockRef.set(
      {
        status: 'done',
        dupGroups: newDupes.length,
        emailSent,
        zaloSent,
        zaloReason: zaloSent ? '' : zalo.reason || 'unknown',
        finishedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    console.log('outbound-dup-notify-5m: notified', {
      newGroups: newDupes.length,
      emailSent,
      zaloSent,
      bucket
    });
  } catch (e) {
    console.error('outbound-dup-notify-30m failed', e);
    await lockRef.set(
      {
        status: 'error',
        errorAt: admin.firestore.FieldValue.serverTimestamp(),
        error: (e as Error)?.message || String(e)
      },
      { merge: true }
    );
  }
}

/**
 * Quét trùng tại thời điểm gọi và gửi mail (nút Send Mail trên Control Batch).
 * `settings` nếu có (từ app) = đúng mốc ngày + loại trừ đang hiển thị; không thì đọc Firestore.
 */
export async function sendOutboundDupReportManual(
  db: admin.firestore.Firestore,
  settings?: ControlBatchDupSettings
): Promise<{ dupGroups: number }> {
  const s = settings ?? (await loadControlBatchDupSettings(db));
  const dupes = await scanOutboundDuplicates(db, s);
  const excl = s.exclusion;
  const cfg = getEmailCfg();
  if (!cfg) {
    throw new Error('Thiếu cấu hình SMTP (EMAIL_USER, EMAIL_PASS, EMAIL_TO)');
  }
  const at = new Date();
  const atStr = at.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false
  });
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass }
  });

  const exclNote =
    excl.enabled && excl.codes.size > 0
      ? `\n\nGhi chú: đang bật loại trừ ${excl.codes.size} dòng danh mục (mã đủ hoặc 4 ký tự = tiền tố nhóm).`
      : excl.enabled
        ? '\n\nGhi chú: đang bật loại trừ (danh sách mã trống).'
        : '';
  const exclHtml =
    excl.enabled && excl.codes.size > 0
      ? `<p style="color:#1565c0;font-size:13px"><strong>Ghi chú:</strong> Đang bật loại trừ ${excl.codes.size} dòng danh mục (mã đủ hoặc 4 ký tự = tiền tố nhóm).</p>`
      : excl.enabled
        ? `<p style="color:#1565c0;font-size:13px"><strong>Ghi chú:</strong> Đang bật loại trừ (danh sách mã trống).</p>`
        : '';

  if (dupes.length === 0) {
    await transporter.sendMail({
      from: cfg.from,
      to: cfg.to.join(', '),
      subject: `[Control Batch] Báo cáo — không có nhóm trùng (${atStr})`,
      text:
        `Kiểm tra trùng xuất kho (từ ${s.dupSinceLabel}, đủ điều kiện định dạng).\n` +
        `Thời điểm quét: ${atStr}\n\nKhông có nhóm trùng (mã + PO + IMD + Bịch + Bag, >1 lần).` +
        exclNote,
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p><strong>Control Batch</strong> — báo cáo từ nút Send Mail.</p>
<p>Thời điểm quét: <strong>${esc(atStr)}</strong></p>
${exclHtml}
<p>Không có nhóm trùng xuất kho.</p>
<p style="color:#555;font-size:12px">Gửi từ Tuấn Anh</p>
</body></html>`
    });
    return { dupGroups: 0 };
  }

  const bodyHtml = buildHtml(dupes, s.dupSinceLabel, exclHtml).replace(
    '</body>',
    `<p style="margin-top:12px">Thời điểm quét: <strong>${esc(
      atStr
    )}</strong> (báo cáo từ nút Send Mail).</p></body>`
  );
  await transporter.sendMail({
    from: cfg.from,
    to: cfg.to.join(', '),
    subject: `[Control Batch] Báo cáo — ${dupes.length} nhóm trùng xuất kho (${atStr})`,
    text: `${buildPlainText(dupes, s.dupSinceLabel, exclNote.trim() || undefined)}\n\n---\nThời điểm quét: ${atStr}`,
    html: bodyHtml
  });
  return { dupGroups: dupes.length };
}

function vnDateKey(d = new Date()): string {
  const vn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const y = vn.getUTCFullYear();
  const m = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const day = String(vn.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Chạy theo lịch 12h / 17h (VN). Khóa theo ngày + khung giờ để idempotent.
 * SMTP: params EMAIL_USER, secret EMAIL_PASS, EMAIL_TO (+ tuỳ chọn EMAIL_FROM, EMAIL_SMTP_*).
 */
export async function runOutboundDupNotifyForSlot(
  db: admin.firestore.Firestore,
  slot: '12' | '17'
): Promise<void> {
  const dateKey = vnDateKey(new Date());
  const lockId = `${dateKey}-${slot}h`;
  const lockRef = db.collection('outbound-dup-notify-locks').doc(lockId);

  const canProceed = await db.runTransaction(async tx => {
    const snap = await tx.get(lockRef);
    if (snap.exists) {
      const st = (snap.data() as { status?: string })?.status;
      if (st === 'done' || st === 'sending') {
        return false;
      }
    }
    tx.set(
      lockRef,
      { status: 'sending', slot, dateKey, startedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    return true;
  });
  if (!canProceed) {
    console.log('outbound-dup-notify: skip (lock)', lockId);
    return;
  }

  try {
    const settings = await loadControlBatchDupSettings(db);
    const dupes = await scanOutboundDuplicates(db, settings);
    if (dupes.length === 0) {
      await lockRef.set(
        {
          status: 'done',
          dupGroups: 0,
          emailSent: false,
          finishedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      return;
    }

    const emailCfg = getEmailCfg();
    if (!emailCfg) {
      console.error(
        'outbound-dup-notify: có trùng nhưng thiếu SMTP (EMAIL_USER, secret EMAIL_PASS, EMAIL_TO)'
      );
      await lockRef.set(
        {
          status: 'done',
          dupGroups: dupes.length,
          emailSent: false,
          emailSkippedReason: 'missing_smtp_config',
          finishedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      return;
    }

    await sendDupEmail(dupes, emailCfg, settings);
    await lockRef.set(
      {
        status: 'done',
        dupGroups: dupes.length,
        emailSent: true,
        finishedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    console.log('outbound-dup-notify: emailed', dupes.length, 'groups', lockId);
  } catch (e) {
    console.error('outbound-dup-notify failed', e);
    await lockRef.set(
      {
        status: 'error',
        errorAt: admin.firestore.FieldValue.serverTimestamp(),
        error: (e as Error)?.message || String(e)
      },
      { merge: true }
    );
  }
}
