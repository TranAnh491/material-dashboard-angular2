/**
 * Đồng bộ logic với `RmBagHistoryService.parseQrPart4` (Angular) +
 * khôi phục tem Bag đầy đủ khi Firestore chỉ có bagBatch dạng i/tổng (vd 8/8)
 * nhưng đuôi (T…) nằm trong notes / chuỗi QR đầy đủ.
 */

export type ParsedQrPart4 = {
  imdKey: string;
  bagFractionLabel: string;
  bagNumberDisplay: string;
};

export function normalizeParenAscii(s: string): string {
  return String(s || '')
    .replace(/\uFF08/g, '(')
    .replace(/\uFF09/g, ')')
    .trim();
}

/** Parse phần 4 QR — mirror Angular `parseQrPart4`. */
export function parseQrPart4(part4: string | null | undefined): ParsedQrPart4 {
  const raw0 = String(part4 ?? '').trim();
  const raw = typeof raw0.normalize === 'function' ? raw0.normalize('NFKC') : raw0;
  if (!raw) {
    return { imdKey: '', bagFractionLabel: '', bagNumberDisplay: '' };
  }

  let splitSuffix = '';
  let head = raw;
  const splitM = /^(.+?)(?:\(([Tt]\d+)\)|([Tt]\d+))$/.exec(raw);
  if (splitM) {
    head = splitM[1].trim();
    const tag = (splitM[2] || splitM[3] || '').trim();
    splitSuffix = tag ? `(${tag.toUpperCase()})` : '';
  }

  const m = /^(\d{8})-(\d+)\/(\d+)$/.exec(head);
  if (m) {
    const num = m[2];
    const den = m[3];
    const bagFractionLabel = `${num}/${den}`;
    const bagNumberDisplay = splitSuffix ? `${num}${splitSuffix}` : num;
    return {
      imdKey: m[1],
      bagFractionLabel,
      bagNumberDisplay
    };
  }

  if (/^\d{8}$/.test(head)) {
    return { imdKey: head, bagFractionLabel: '', bagNumberDisplay: '' };
  }

  const lead8 = /^(\d{8})/.exec(head);
  if (lead8) {
    return {
      imdKey: lead8[1],
      bagFractionLabel: '',
      bagNumberDisplay: ''
    };
  }

  return { imdKey: head, bagFractionLabel: '', bagNumberDisplay: '' };
}

function extractQrPart4HintsFromNotes(notes: string | null | undefined): string[] {
  const n = String(notes ?? '');
  const out: string[] = [];
  const re = /\d{8}-\d+\/\d+(?:\([^)]*\)|(?:[Tt]\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(n)) !== null) {
    out.push(m[0]);
  }
  return out;
}

export type OutboundBagStickerResolved = {
  /** Khóa gộp trùng — luôn ưu tiên tem đầy đủ, không chỉ i/tổng. */
  sticker: string;
  bagBatchRaw: string;
  bagNumberDisplayRaw: string;
};

/**
 * Khóa Bag cho Control Batch / mail / Zalo:
 * 1) bagNumberDisplay trên doc (chuẩn hoá ngoặc)
 * 2) Parse importDate / batchNumber / notes (QR đầy đủ hoặc đoạn DDMMYYYY-i/j(T…))
 * 3) Fallback bagBatch (VD 8/8)
 */
export function resolveOutboundBagDupSticker(d: Record<string, unknown>): OutboundBagStickerResolved {
  const bagBatchRaw = normalizeParenAscii(
    d['bagBatch'] != null && String(d['bagBatch']).trim() !== '' ? String(d['bagBatch']) : ''
  );

  let bagNumberDisplayRaw = '';
  if (d['bagNumberDisplay'] != null && String(d['bagNumberDisplay']).trim() !== '') {
    bagNumberDisplayRaw = normalizeParenAscii(String(d['bagNumberDisplay']));
  }

  if (bagNumberDisplayRaw) {
    return { sticker: bagNumberDisplayRaw, bagBatchRaw, bagNumberDisplayRaw };
  }

  const tries: string[] = [];
  const push = (x: unknown) => {
    const s = normalizeParenAscii(String(x ?? '').trim());
    if (s) tries.push(s);
  };

  push(d['importDate']);
  push(d['batchNumber']);
  for (const hint of extractQrPart4HintsFromNotes(d['notes'] != null ? String(d['notes']) : '')) {
    push(hint);
  }

  const noteLines = String(d['notes'] ?? '').split(/[\r\n]+/);
  for (const line of noteLines) {
    const t = line.trim();
    if (!t) continue;
    if (t.includes('|')) {
      const parts = t.split('|').map(p => p.trim());
      if (parts.length >= 4) push(parts[3]);
    }
  }

  for (const c of tries) {
    const p = parseQrPart4(c);
    const b = normalizeParenAscii(p.bagNumberDisplay);
    if (b) {
      return { sticker: b, bagBatchRaw, bagNumberDisplayRaw };
    }
  }

  return { sticker: bagBatchRaw, bagBatchRaw, bagNumberDisplayRaw };
}
