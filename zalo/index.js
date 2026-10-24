/**
 * Zalo Bot Platform (Firebase Functions codebase: zalo)
 *
 * Chỉ còn giữ hạ tầng dùng chung cho 2 tính năng Zalo:
 * - Nhiệt Độ: nhắc cập nhật biểu mẫu (xem functions/src/nhiet-do-zalo-remind.ts)
 * - Location: OTP thêm vị trí mới (xem functions/src/location-add-otp.ts)
 *
 * File này chỉ còn webhook nhận tin để nhân viên liên kết mã NV (ASPxxxx) với
 * chatId Zalo (ghi vào collection `zalo_links`) — cả 2 tính năng trên đọc
 * `zalo_links` để tra chatId người nhận. Mọi tính năng Zalo khác (scrap, tồn
 * kho, đăng ký nhóm TBHD/Quản lý kho/ASM, cảnh báo Outbound/Putaway/QC/FG...)
 * đã được gỡ bỏ.
 *
 * Webhook:
 * - Docs: https://bot.zapps.me/docs/webhook/
 * - Verify header: X-Bot-Api-Secret-Token === ZALO_WEBHOOK_SECRET
 *
 * Secrets:
 * - firebase functions:secrets:set ZALO_BOT_TOKEN        (bot token dạng 123:abc...)
 * - firebase functions:secrets:set ZALO_WEBHOOK_SECRET  (secret token bạn nhập trong app bot)
 */

const {setGlobalOptions} = require("firebase-functions");
const {defineSecret} = require("firebase-functions/params");
const {onRequest} = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const ZALO_BOT_TOKEN = defineSecret("ZALO_BOT_TOKEN");
const ZALO_WEBHOOK_SECRET = defineSecret("ZALO_WEBHOOK_SECRET");

const ZALO_BOT_SEND_MESSAGE_URL = (token) =>
  `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/sendMessage`;

setGlobalOptions({maxInstances: 10});

const WO_STATUS_LABELS = {
  "waiting": "Waiting",
  "kitting": "Kitting",
  "ready": "Ready",
  "ready-iqc": "Ready IQC",
  "transfer": "Transfer",
  "done": "Done",
  "delay": "Delay",
};

/** Ngày hiện tại theo giờ Việt Nam: { key: "YYYY-MM-DD", start, end } (UTC Date). */
function vnTodayRange(now = new Date()) {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const start = new Date(`${key}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {key, start, end};
}

function normalizeLsx(raw) {
  return String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
}

function chunkLines(title, lines, max = 1800) {
  const chunks = [];
  let current = title;
  for (const line of lines) {
    const next = `${current}\n${line}`;
    if (next.length > max && current !== title) {
      chunks.push(current);
      current = `${title}\n${line}`;
    } else {
      current = next;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

/** Trạng thái các LSX có Ngày giao NVL (deliveryDate) là hôm nay. */
async function buildTodayLsxStatusMessages() {
  const {key, start, end} = vnTodayRange();
  const [y, m, d] = key.split("-");
  const dayLabel = `${d}/${m}/${y}`;
  const snap = await db
    .collection("work-orders")
    .where("deliveryDate", ">=", start)
    .where("deliveryDate", "<", end)
    .get();
  const rows = snap.docs
    .map((doc) => doc.data() || {})
    .filter((wo) => String(wo.productionOrder || "").trim());
  if (!rows.length) return [`Không có LSX nào giao NVL ngày ${dayLabel}.`];

  rows.sort((a, b) => {
    const ua = a.isUrgent ? 1 : 0;
    const ub = b.isUrgent ? 1 : 0;
    if (ua !== ub) return ub - ua;
    const fa = String(a.factory || "");
    const fb = String(b.factory || "");
    if (fa !== fb) return fa.localeCompare(fb);
    return String(a.productionOrder).localeCompare(String(b.productionOrder));
  });

  const counts = {};
  rows.forEach((wo) => {
    const label = WO_STATUS_LABELS[String(wo.status || "waiting")] || "Waiting";
    counts[label] = (counts[label] || 0) + 1;
  });
  const summary = Object.keys(counts).map((k) => `${k}: ${counts[k]}`).join(", ");
  const title = `Trạng thái LSX giao NVL ngày ${dayLabel} (${rows.length} LSX)\n${summary}`;
  const lines = rows.map((wo, i) => {
    const label = WO_STATUS_LABELS[String(wo.status || "waiting")] || "Waiting";
    const factory = wo.factory ? ` (${wo.factory})` : "";
    const urgent = wo.isUrgent ? " - Ưu tiên" : "";
    return `${i + 1}. ${String(wo.productionOrder).trim()}${factory}: ${label}${urgent}`;
  });
  return chunkLines(title, lines);
}

/** Bật ưu tiên (isUrgent) cho một hoặc nhiều LSX. */
async function setLsxPriority(rawArgs) {
  const lsxList = Array.from(new Set(
    String(rawArgs || "")
      .split(/[\s,;]+/)
      .map(normalizeLsx)
      .filter(Boolean)
  )).slice(0, 20);
  if (!lsxList.length) return "Nhập LSX sau chữ Ưu tiên. VD: Ưu tiên KZLSX1026/0010";

  const results = [];
  for (const lsx of lsxList) {
    const snap = await db.collection("work-orders").where("productionOrder", "==", lsx).limit(10).get();
    if (snap.empty) {
      results.push(`Không tìm thấy LSX ${lsx}.`);
      continue;
    }
    const pending = snap.docs.filter((doc) => !doc.data()?.isUrgent);
    if (!pending.length) {
      results.push(`LSX ${lsx} đã được ưu tiên trước đó.`);
      continue;
    }
    const batch = db.batch();
    pending.forEach((doc) => batch.update(doc.ref, {isUrgent: true, lastUpdated: new Date()}));
    await batch.commit();
    const label = WO_STATUS_LABELS[String(snap.docs[0].data()?.status || "waiting")] || "Waiting";
    results.push(`Đã bật ưu tiên LSX ${lsx} (${label}).`);
  }
  return results.join("\n");
}

/** Danh sách lệnh theo nhóm đang chat (gõ "chucnang"). */
async function groupFeatureText(chatId) {
  const [pln, qlk, kho] = await Promise.all([
    db.collection("zalo_group_config").doc("pln").get(),
    db.collection("zalo_group_config").doc("quanly_kho").get(),
    db.collection("zalo_groups").doc("kho").get(),
  ]);
  const idOf = (snap) => String(snap.data()?.chatId || "").trim();
  if (chatId === idOf(pln)) {
    return "Chức năng nhóm PLN:\n" +
      "- LSX  → trạng thái các LSX giao NVL hôm nay (lsx / LSX đều được)\n" +
      "- Ưu tiên <LSX>  → bật ưu tiên, VD: Ưu tiên KZLSX1026/0010\n" +
      "- Tự báo LSX Ready-IQC (mã đang chờ IQC)\n" +
      "- chucnang  → xem lại danh sách này";
  }
  if (chatId === idOf(qlk)) {
    return "Chức năng nhóm Quản lý kho:\n" +
      "- Nhận báo cáo Check lượng PXK\n" +
      "- Rep tin báo cáo bằng: duyệt  → duyệt mã trong tin đó\n" +
      "- Hoặc gõ: duyệt <Mã hàng>  (VD: duyệt B008119)\n" +
      "- chucnang  → xem lại danh sách này";
  }
  if (chatId === idOf(kho)) {
    return "Chức năng nhóm Kho:\n" +
      "- Nhận file hướng dẫn Scan từ app (nút Gửi Zalo)\n" +
      "- chucnang  → xem lại danh sách này";
  }
  return "Danh sách câu lệnh:\n" +
    "- /link   (liên kết mã nhân viên để nhận thông báo)\n" +
    "- /id     (xem mã nhân viên đã liên kết)\n" +
    "- /nhomkho  (trong nhóm Kho: gắn nhóm nhận file hướng dẫn Scan)\n" +
    "- /nhompln  (trong nhóm PLN: gắn nhóm nhận báo Ready-IQC)\n" +
    "- chucnang  (xem chức năng của nhóm đang chat)\n" +
    "- <mã NVL>  (VD: B008119 → tồn kho, số bag, chi tiết PO + vị trí)\n" +
    "- /standar <mã NVL> <số>  (sửa Standard, VD: /standar B008119 500)";
}

/**
 * Duyệt báo cáo Check lượng PXK (giống nút Duyệt trên web):
 * mã vào pxk-weight-check-exempt, các báo cáo pending của mã → approved.
 */
async function approvePxkWeightFromZalo(codeRaw, decidedBy) {
  const pendingSnap = await db.collection("pxk-weight-check-reports").where("status", "==", "pending").get();
  const pending = pendingSnap.docs.map((d) => ({id: d.id, ...d.data()}));
  let code = String(codeRaw || "").trim().toUpperCase();
  if (!code) {
    const codes = Array.from(new Set(pending.map((r) => String(r.materialCode || "").trim().toUpperCase()).filter(Boolean)));
    if (codes.length === 1) {
      code = codes[0];
    } else if (!codes.length) {
      return "Không có báo cáo Check lượng nào đang chờ duyệt.";
    } else {
      return `Đang có ${codes.length} mã chờ duyệt: ${codes.join(", ")}.
Gõ: duyệt <Mã hàng> (VD: duyệt ${codes[0]}).`;
    }
  }
  const same = pending.filter((r) => String(r.materialCode || "").trim().toUpperCase() === code);
  if (!same.length) return `Mã ${code} không có báo cáo nào đang chờ duyệt.`;
  const latest = same[0];
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(db.collection("pxk-weight-check-exempt").doc(code), {
    materialCode: code,
    approvedAt: now,
    approvedBy: decidedBy,
    reportId: latest.id,
    reason: String(latest.reason || ""),
    lsx: String(latest.lsx || ""),
    source: "zalo",
  }, {merge: true});
  for (const r of same) {
    batch.update(db.collection("pxk-weight-check-reports").doc(r.id), {status: "approved", decidedAt: now, decidedBy});
  }
  await batch.commit();
  return `✅ Đã duyệt mã ${code} (${same.length} báo cáo) — người duyệt ${decidedBy}.
Mã này không còn bị check lượng.`;
}

/** Số kiểu 12,500 / 12.5 */
function fmtQty(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toLocaleString("en-US", {maximumFractionDigits: 2});
}

function fmtDateVn(ts) {
  if (!ts) return "";
  const d = typeof ts.toDate === "function" ? ts.toDate() : (ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts));
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(d);
}

/** Đọc số người dùng gõ: "500", "1,000", "12.5", "12,5". */
function parseQtyInput(raw) {
  let s = String(raw || "").trim().replace(/\s/g, "");
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, "");
  else s = s.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/** Giống tab Materials: tồn = tồn đầu + nhập − xuất − XT. */
function inventoryRowStock(d) {
  const opening = d.openingStock !== null && d.openingStock !== undefined ? Number(d.openingStock) || 0 : 0;
  return opening + (Number(d.quantity) || 0) - (Number(d.exported) || 0) - (Number(d.xt) || 0);
}

/** Giống cột BAG tab Materials: chẵn + 1 nếu có lẻ; chưa có Standard → số bag đã lưu. */
function inventoryRowBags(d, stock, sp) {
  if (!(sp > 0)) {
    const stored = Number(d.totalBags || 0);
    return stored > 0 ? Math.floor(stored) : 0;
  }
  if (stock <= 0) return 0;
  const full = Math.floor(stock / sp);
  const partial = Math.round((stock - full * sp) * 1e6) / 1e6;
  return partial <= 1e-9 ? full : full + 1;
}

/** Nhớ tạm trong instance (đỡ lượt đọc Firestore khi tra lặp lại). */
const CATALOG_TTL_MS = 10 * 60 * 1000;
const catalogCache = new Map();

async function getNvlCatalogItem(code, fresh = false) {
  const hit = catalogCache.get(code);
  if (!fresh && hit && Date.now() - hit.ts < CATALOG_TTL_MS) return hit.item;
  let item = null;
  const byId = await db.collection("materials").doc(code).get();
  if (byId.exists) {
    item = {ref: byId.ref, data: byId.data() || {}};
  } else {
    const q = await db.collection("materials").where("materialCode", "==", code).limit(1).get();
    if (!q.empty) item = {ref: q.docs[0].ref, data: q.docs[0].data() || {}};
  }
  catalogCache.set(code, {item, ts: Date.now()});
  return item;
}

/** Tồn LinkQ theo nhà máy: linkQFiles/{factory}.linkQData = {mã: tồn} (cùng nguồn tab Materials / Inventory Overview). */
const linkQCache = new Map();
/** zalo_links theo chatId — 10 phút / instance. */
const LINK_TTL_MS = 10 * 60 * 1000;
const linkedProfileCache = new Map();
/** Mã vừa tra theo chat — đọc trước ở đây, không có mới đọc Firestore zalo_last_material. */
const lastMaterialMem = new Map();
async function getLinkQPack(factory) {
  const hit = linkQCache.get(factory);
  if (hit && Date.now() - hit.ts < 30 * 60 * 1000) return hit.pack;
  let data = null;
  const canonical = await db.collection("linkQFiles").doc(factory).get();
  if (canonical.exists) {
    data = canonical.data() || null;
  } else {
    const snap = await db.collection("linkQFiles").where("factory", "==", factory).limit(20).get();
    const ms = (d) => d?.uploadDate?.toMillis?.() || (d?.uploadDate?.seconds ? d.uploadDate.seconds * 1000 : 0);
    const docs = snap.docs.map((x) => x.data() || {}).sort((a, b) => ms(b) - ms(a));
    data = docs[0] || null;
  }
  const map = new Map();
  for (const [code, stock] of Object.entries(data?.linkQData || {})) {
    const key = String(code || "").trim().toUpperCase().replace(/\s+/g, "");
    if (key) map.set(key, Math.round(Number(stock) || 0));
  }
  const pack = {map, uploadDate: fmtDateVn(data?.uploadDate), hasFile: !!data};
  linkQCache.set(factory, {pack, ts: Date.now()});
  return pack;
}

/** Nhắn mã NVL → tổng tồn, số bag, chi tiết PO + vị trí (đọc inventory-materials). */
async function buildMaterialStockMessages(code) {
  const [invSnap, cat] = await Promise.all([
    db.collection("inventory-materials").where("materialCode", "==", code).get(),
    getNvlCatalogItem(code),
  ]);
  const linkQFactories = ["ASM1", "ASM2"];
  const linkQ = await Promise.all(linkQFactories.map((f) => getLinkQPack(f).catch((e) => {
    logger.warn("linkQ load failed", {f, e: String(e)});
    return null;
  })));
  const linkQRows = linkQFactories
    .map((f, i) => ({f, pack: linkQ[i]}))
    .filter((x) => x.pack?.map.has(code))
    .map((x) => ({f: x.f, qty: x.pack.map.get(code), date: x.pack.uploadDate}));

  if (!cat && invSnap.empty && !linkQRows.length) return null;

  const catSp = Number(cat?.data?.standardPacking) || 0;
  const name = String(cat?.data?.materialName || "").trim();
  const unit = String(cat?.data?.unit || "").trim();

  const rows = invSnap.docs.map((doc) => {
    const d = doc.data() || {};
    const stock = inventoryRowStock(d);
    const rowSp = Number(d.standardPacking) || 0;
    const sp = catSp > 0 ? catSp : rowSp;
    const imp = d.importDate;
    return {
      factory: String(d.factory || "?").trim().toUpperCase(),
      po: String(d.poNumber || "").trim() || "—",
      location: String(d.location || d.viTri || "").trim().toUpperCase() || "—",
      imd: fmtDateVn(imp),
      impMs: imp?.toMillis ? imp.toMillis() : (imp?.seconds ? imp.seconds * 1000 : 0),
      stock,
      bags: inventoryRowBags(d, stock, sp),
    };
  }).filter((r) => r.stock > 1e-9);

  const head = `📦 ${code}${name ? ` - ${name}` : ""}`;
  const spLine = `Standard: ${catSp > 0 ? fmtQty(catSp) : "chưa có"}${cat?.data?.standardPackingLocked === true ? " (Lock)" : ""}`;
  const unitTxt = unit ? ` ${unit}` : "";
  const webByFactory = (f) => rows.filter((r) => r.factory === f).reduce((s, r) => s + r.stock, 0);
  const linkQLine = linkQRows.length ?
    linkQRows.map((x) => {
      const diff = Math.round(webByFactory(x.f) - x.qty);
      const diffTxt = Math.abs(diff) > 1 ? ` (web lệch ${diff > 0 ? "+" : ""}${fmtQty(diff)})` : " (khớp web)";
      return `LinkQ ${x.f}: ${fmtQty(x.qty)}${diffTxt}${x.date ? ` · file ${x.date}` : ""}`;
    }).join("\n") :
    "LinkQ: không có mã này trong file LinkQ";
  if (!rows.length) {
    return [`${head}\n${spLine}\nHết tồn kho trên web (0${unitTxt}).\n${linkQLine}`];
  }


  rows.sort((a, b) => a.factory.localeCompare(b.factory) || a.impMs - b.impMs || a.po.localeCompare(b.po));
  const totalStock = rows.reduce((s, r) => s + r.stock, 0);
  const totalBags = rows.reduce((s, r) => s + r.bags, 0);
  const factories = Array.from(new Set(rows.map((r) => r.factory)));

  const title = `${head}\n${spLine}\nTổng: ${fmtQty(totalStock)}${unitTxt} · ${totalBags} bag · ${rows.length} dòng\n${linkQLine}`;
  const lines = [];
  for (const f of factories) {
    const fr = rows.filter((r) => r.factory === f);
    const fs = fr.reduce((s, r) => s + r.stock, 0);
    const fb = fr.reduce((s, r) => s + r.bags, 0);
    lines.push(factories.length > 1 ? `\n[${f}] ${fmtQty(fs)}${unitTxt} · ${fb} bag` : `\n[${f}]`);
    fr.forEach((r, i) => {
      lines.push(`${i + 1}. PO ${r.po}${r.imd ? ` (${r.imd})` : ""} | ${r.location} | ${fmtQty(r.stock)} | ${r.bags} bag`);
    });
  }
  return chunkLines(title, lines);
}

/** /standar <mã> <số> → ghi Standard Packing vào Danh mục NVL (collection materials), như web. */
async function updateStandardFromZalo(code, sp, editedBy) {
  const cat = await getNvlCatalogItem(code, true);
  if (!cat) return `Không thấy mã ${code} trong Danh mục NVL. Chưa cập nhật gì.`;
  if (cat.data.standardPackingLocked === true) {
    return `⚠️ Standard của ${code} đang Lock trên Danh mục NVL (hiện ${fmtQty(cat.data.standardPacking)}).\nMở Lock trên web rồi nhắn lại.`;
  }
  const old = Number(cat.data.standardPacking) || 0;
  await cat.ref.set({standardPacking: sp, updatedAt: new Date(), lastEditedBy: editedBy}, {merge: true});
  catalogCache.delete(code);
  // Mốc để web tải lại mã vừa sửa (giống NvlCatalogFullService.markRemoteChanged)
  await db.collection("app-meta").doc("nvl-catalog")
    .set({updatedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true})
    .catch((e) => logger.warn("app-meta nvl-catalog stamp failed", e));
  return `✅ Đã cập nhật Standard ${code}: ${old > 0 ? fmtQty(old) : "trống"} → ${fmtQty(sp)}\nNgười sửa: ${editedBy}`;
}

/**
 * Webhook endpoint để dán vào ô "Webhook URL" trong app Bot.
 * - Verify header: X-Bot-Api-Secret-Token
 * - Chỉ xử lý: liên kết mã NV (/link, /id), đổi tên hiển thị, lời chào.
 */
exports.zaloWebhook = onRequest(
  {
    secrets: [ZALO_WEBHOOK_SECRET, ZALO_BOT_TOKEN],
    cors: false,
    invoker: "public",
  },
  async (req, res) => {
    // Some webhook setup screens validate URL with GET.
    if (req.method === "GET" || req.method === "HEAD") {
      res.status(200).send("ok");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({error: "Method Not Allowed"});
      return;
    }

    const incomingSecret = req.get("x-bot-api-secret-token") || "";
    if (incomingSecret !== ZALO_WEBHOOK_SECRET.value()) {
      res.status(403).json({message: "Unauthorized"});
      return;
    }

    logger.info("RAW DATA", {body: req.body});

    // Payload can be either:
    // - { ok: true, result: { event_name, message: { chat: {id}, text } } }
    // - { event_name, message: { chat: {id}, text } }
    const root = req.body || {};
    const result = root.result || root;
    const message = result.message || root.message;

    const eventName = result.event_name || root.event_name;
    const chatId = message?.chat?.id;
    const chatType = String(message?.chat?.chat_type || message?.chat?.chatType || "").trim().toUpperCase();
    const senderName = String(message?.from?.display_name || "").trim();
    const senderId = String(message?.from?.id || "").trim();
    const rawText = message?.text;

    /** Trong nhóm: bỏ @tên_bot ở đầu tin nhắn (tên bot có dấu cách: "@Bot AI Warehouse"). */
    const BOT_MENTIONS = ["@bot ai warehouse", "@ai warehouse"];
    const extractZaloCommandText = (raw) => {
      const t = String(raw || "").trim();
      if (!t || !t.startsWith("@")) return t;
      const lower = t.toLowerCase();
      for (const m of BOT_MENTIONS) {
        if (lower.startsWith(m)) return t.slice(m.length).trim();
      }
      return t.replace(/^@[^\s]+\s+/u, "").trim();
    };

    const text =
      typeof rawText === "string" ? extractZaloCommandText(rawText) : rawText;

    if (eventName === "message.text.received" && chatId) {
      logger.info("Zalo inbound", {
        chatId,
        chatType: chatType || "—",
        senderName: senderName || "—",
        text: typeof text === "string" ? text.slice(0, 120) : text,
        rawText: typeof rawText === "string" ? rawText.slice(0, 120) : rawText,
        senderId,
      });
    }

    const botToken = ZALO_BOT_TOKEN.value();

    const sendText = async (toChatId, replyText) => {
      await fetch(ZALO_BOT_SEND_MESSAGE_URL(botToken), {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({chat_id: toChatId, text: replyText}),
      });
    };

    const normalize = (s) => String(s || "").trim();
    const isGreeting = (s) => {
      const t = normalize(s).toLowerCase().replace(/\s+/g, " ");
      return (
        t === "hi" ||
        t === "hello" ||
        t === "helo" ||
        t === "hi cưng" ||
        t === "hi cung" ||
        t === "cưng" ||
        t === "cung" ||
        t === "cục vàng" ||
        t === "cuc vang" ||
        t === "xin chào" ||
        t === "xin chao" ||
        t === "chào" ||
        t === "chao"
      );
    };

    const isValidEmployeeCode = (code) => /^ASP\d{4}$/.test(String(code || "").toUpperCase());

    const getLinkedProfile = async (id) => {
      const hit = linkedProfileCache.get(id);
      if (hit && Date.now() - hit.ts < LINK_TTL_MS) return hit.data;
      const doc = await db.collection("zalo_links").doc(id).get();
      const data = doc.exists ? doc.data() : null;
      linkedProfileCache.set(id, {data, ts: Date.now()});
      return data;
    };

    // Một mã nhân viên chỉ gắn với một chat. OTP và mật khẩu mới gửi theo mã này,
    // nên chat khác nhắn cùng mã KHÔNG được liên kết đè (admin xóa liên kết cũ ở tab Zalo nếu cần đổi).
    const isMemberLinkedElsewhere = async (memberId, currentChatId) => {
      const snap = await db.collection("zalo_links").where("memberId", "==", memberId).get();
      return snap.docs.some((d) => d.id !== String(currentChatId));
    };

    const getEmployeeNameFromDirectory = async (memberId) => {
      const emp = String(memberId || "").trim().toUpperCase();
      if (!emp) return "";
      try {
        const snap = await db.collection("employee-directory").doc(emp).get();
        if (!snap.exists) return "";
        const d = snap.data() || {};
        const name = String(d.name || d.employeeName || "").trim();
        return name;
      } catch (e) {
        logger.error("employee-directory lookup failed", e);
        return "";
      }
    };

    const startOnboarding = async () => {
      await db
        .collection("zalo_pending")
        .doc(chatId)
        .set(
          {intent: "onboarding", step: "employeeCode", updatedAt: admin.firestore.FieldValue.serverTimestamp()},
          {merge: true}
        );
      await sendText(
        chatId,
        "Vui lòng nhập **Mã nhân viên** (ví dụ: ASP0106).\nSau đó gõ: /id để xác nhận liên kết."
      );
    };

    // Pending conversation state (onboarding)
    // Tin tra mã NVL / đủ-thiếu / standar không cần trạng thái onboarding → không đọc zalo_pending
    const quickText = String(text || "").trim();
    const quickFold = quickText.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
    const isQuickCmd = typeof text === "string" && !isValidEmployeeCode(quickText) && (
      (/^[A-Za-z0-9][A-Za-z0-9._-]{3,30}$/.test(quickText) && /\d/.test(quickText)) ||
      /^(du|thieu)(\s|$)/.test(quickFold) ||
      /^[a-z0-9][a-z0-9._-]{3,30}\s+(du|thieu)(\s|$)/.test(quickFold) ||
      /^\/\s*standa?rd?\b/.test(quickFold)
    );
    if (eventName === "message.text.received" && chatId && typeof text === "string" && !isQuickCmd) {
      try {
        const pendingRef = db.collection("zalo_pending").doc(chatId);
        const pendingSnap = await pendingRef.get();
        const pending = pendingSnap.exists ? pendingSnap.data() : null;

        // Onboarding flow: ask employee code, then user confirms by /id
        if (pending?.intent === "onboarding") {
          const t = normalize(text);
          if (pending.step === "employeeCode") {
            const code = t.toUpperCase();
            if (!isValidEmployeeCode(code)) {
              await sendText(chatId, "Mã nhân viên chưa đúng. Vui lòng nhập theo dạng ASP + 4 số (ví dụ: ASP0106).");
              res.status(200).json({ok: true});
              return;
            }

            await pendingRef.set(
              {intent: "link_emp", step: "confirm", memberId: code, updatedAt: admin.firestore.FieldValue.serverTimestamp()},
              {merge: true}
            );
            await sendText(chatId, `Đã nhận mã ${code}. Vui lòng gõ: /id để xác nhận liên kết.`);
            res.status(200).json({ok: true});
            return;
          }
        }

      } catch (err) {
        logger.error("pending state read failed", err);
      }
    }


    // Greetings:
    // - Always show intro + guidance
    if (eventName === "message.text.received" && chatId && typeof text === "string" && isGreeting(text)) {
      try {
        await sendText(
          chatId,
          "Xin chào, em là trợ lý kho.\n" +
            "Gõ /link rồi nhập mã nhân viên (VD: ASP0106) để liên kết nhận thông báo qua Zalo.\n" +
            "Gõ /id để xem mã đã liên kết.\n" +
            "Nhắn mã NVL (VD: B008119) để xem tồn kho; /standar <mã> <số> để sửa Standard.\n\n" +
            "Gõ chucnang để xem các chức năng của nhóm đang chat."
        );
      } catch (err) {
        logger.error("greeting handler failed", err);
      }
      res.status(200).json({ok: true});
      return;
    }

    const chucNangKey = String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase()
      .replace(/[\s/]+/g, "");
    if (eventName === "message.text.received" && chatId && typeof text === "string" && chucNangKey === "chucnang") {
      try {
        await sendText(chatId, await groupFeatureText(String(chatId)));
      } catch (err) {
        logger.error("chucnang command failed", err);
      }
      res.status(200).json({ok: true});
      return;
    }

    const isGroupChat =
      chatType === "GROUP" || chatType === "GROUPCHAT" || chatType === "GROUP_CHAT";
    const chatName = String(
      message?.chat?.name || message?.chat?.title || message?.chat?.display_name || ""
    ).trim();
    const compactCmd = String(text || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");
    const isNhomKhoCommand =
      compactCmd.includes("/nhomkho") ||
      compactCmd.includes("/nhómkho") ||
      compactCmd.includes("/dangkykho");

    if (eventName === "message.text.received" && chatId && typeof text === "string" && isNhomKhoCommand) {
      try {
        if (!isGroupChat) {
          await sendText(chatId, "Lệnh /nhomkho chỉ dùng trong nhóm. Mở nhóm Kho, @bot rồi gõ /nhomkho.");
        } else {
          await db.collection("zalo_groups").doc("kho").set(
            {
              key: "kho",
              name: chatName || "Kho",
              chatId: String(chatId),
              chatType: chatType || "GROUP",
              source: "zaloWebhook:/nhomkho",
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            {merge: true}
          );
          await sendText(
            chatId,
            "Đã gắn nhóm này là nhóm Kho.\nApp bấm “Gửi Zalo” sẽ gửi file hướng dẫn Scan vào đây."
          );
        }
      } catch (err) {
        logger.error("nhomkho command failed", err);
        await sendText(chatId, "Không gắn được nhóm Kho. Thử lại.");
      }
      res.status(200).json({ok: true});
      return;
    }

    const isNhomPlnCommand =
      compactCmd.includes("/nhompln") ||
      compactCmd.includes("/nhómpln") ||
      compactCmd.includes("/dangkypln");

    if (eventName === "message.text.received" && chatId && typeof text === "string" && isNhomPlnCommand) {
      try {
        if (!isGroupChat) {
          await sendText(chatId, "Lệnh /nhompln chỉ dùng trong nhóm. Mở nhóm PLN, @bot rồi gõ /nhompln.");
        } else {
          await db.collection("zalo_group_config").doc("pln").set(
            {
              key: "pln",
              label: "PLN",
              name: chatName || "PLN",
              purpose: "pln",
              chatId: String(chatId),
              chatType: chatType || "GROUP",
              source: "zaloWebhook:/nhompln",
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            {merge: true}
          );
          await sendText(
            chatId,
            "Đã gắn nhóm này là nhóm PLN.\nLSX Ready-IQC sẽ báo mã đang chờ IQC vào đây."
          );
        }
      } catch (err) {
        logger.error("nhompln command failed", err);
        await sendText(chatId, "Không gắn được nhóm PLN. Thử lại.");
      }
      res.status(200).json({ok: true});
      return;
    }

    const foldedText = String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    const isLsxStatusCommand = foldedText === "lsx" || foldedText === "lsx hom nay";

    // Nhóm Quản lý kho: rep tin "Báo cáo Check lượng PXK" bằng "duyệt" → duyệt mã đó
    const approveMatch = foldedText.match(/^duyet(?:\s+([a-z0-9][a-z0-9._-]*))?$/);
    if (eventName === "message.text.received" && chatId && typeof text === "string" && approveMatch) {
      try {
        const khoSnap = await db.collection("zalo_group_config").doc("quanly_kho").get();
        const khoChatId = String(khoSnap.data()?.chatId || "").trim();
        if (khoChatId && String(chatId) === khoChatId) {
          const quoted = String(
            message?.quote?.text || message?.quote_message?.text || message?.reply_to_message?.text ||
            message?.quoted_message?.text || message?.reply?.text || ""
          );
          const fromQuote = (quoted.match(/Mã hàng:\s*([A-Za-z0-9._-]+)/) || [])[1] || "";
          const code = String(approveMatch[1] || fromQuote || "").trim().toUpperCase();
          const linked = senderId ? await getLinkedProfile(senderId).catch(() => null) : null;
          const by = String(linked?.memberId || "").trim().toUpperCase() || `Zalo: ${senderName || senderId || "?"}`;
          await sendText(chatId, await approvePxkWeightFromZalo(code, by));
        }
      } catch (err) {
        logger.error("duyet command failed", err);
        await sendText(chatId, "Lỗi khi duyệt. Thử lại hoặc duyệt trên web.");
      }
      res.status(200).json({ok: true});
      return;
    }
    const priorityMatch = foldedText.match(/^uu ?tien\s+(.+)$/);

    if (eventName === "message.text.received" && chatId && typeof text === "string" && (isLsxStatusCommand || priorityMatch)) {
      try {
        const plnSnap = await db.collection("zalo_group_config").doc("pln").get();
        const plnChatId = String(plnSnap.data()?.chatId || "").trim();
        if (!plnChatId) {
          await sendText(chatId, "Chưa gắn nhóm PLN. Mở nhóm PLN, @bot rồi gõ /nhompln.");
        } else if (String(chatId) !== plnChatId) {
          await sendText(chatId, "Lệnh này chỉ dùng trong nhóm PLN.");
        } else if (isLsxStatusCommand) {
          for (const part of await buildTodayLsxStatusMessages()) {
            await sendText(chatId, part);
          }
        } else {
          await sendText(chatId, await setLsxPriority(priorityMatch[1]));
        }
      } catch (err) {
        logger.error("PLN LSX command failed", err);
        await sendText(chatId, "Lỗi khi xử lý lệnh LSX. Thử lại.");
      }
      res.status(200).json({ok: true});
      return;
    }

    if (eventName === "message.text.received" && chatId && isGroupChat) {
      const nameNorm = chatName.toLowerCase().replace(/\s+/g, " ").trim();
      if (nameNorm === "kho" || nameNorm === "nhóm kho" || nameNorm === "nhom kho") {
        db.collection("zalo_groups").doc("kho").set(
          {
            key: "kho",
            name: chatName || "Kho",
            chatId: String(chatId),
            chatType: chatType || "GROUP",
            source: "zaloWebhook:group-name",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          {merge: true}
        ).catch((err) => logger.error("auto save nhóm Kho failed", err));
      }
    }

    if (eventName === "message.text.received" && chatId && typeof text === "string" && text.trim() === "/link") {
      try {
        await startOnboarding();
      } catch (err) {
        logger.error("link command failed", err);
      }
      res.status(200).json({ok: true});
      return;
    }

    if (eventName === "message.text.received" && chatId && text === "/id") {
      try {
        const profile = await getLinkedProfile(chatId);
        if (profile?.memberId) {
          await sendText(chatId, `ID: ${profile.memberId}`);
        } else {
          const pendingRef = db.collection("zalo_pending").doc(chatId);
          const pendingSnap = await pendingRef.get().catch(() => null);
          const pending = pendingSnap?.exists ? pendingSnap.data() : null;
          const memberId = String(pending?.memberId || "").trim().toUpperCase();
          if (pending?.intent === "link_emp" && isValidEmployeeCode(memberId) && await isMemberLinkedElsewhere(memberId, chatId)) {
            await pendingRef.delete().catch(() => {});
            await sendText(chatId, `Mã ${memberId} đã liên kết ở chat khác. Liên hệ quản trị viên nếu cần đổi.`);
          } else if (pending?.intent === "link_emp" && isValidEmployeeCode(memberId)) {
            const nameFromDir = await getEmployeeNameFromDirectory(memberId);
            const name = nameFromDir || memberId;
            linkedProfileCache.delete(chatId);
            await db.collection("zalo_links").doc(chatId).set(
              {
                chatId,
                name,
                memberId,
                source: "zaloWebhook",
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              {merge: true}
            );
            await pendingRef.delete().catch(() => {});
            await sendText(
              chatId,
              `Đã liên kết thành công.\nMã: ${memberId}\nTên: ${name}`
            );
          } else {
            await sendText(chatId, "Bạn chưa liên kết. Nhắn mã nhân viên (VD: ASP0609) rồi gõ /id, hoặc gõ /link.");
          }
        }
      } catch (err) {
        logger.error("id command failed", err);
      }
      res.status(200).json({ok: true});
      return;
    }

    // Update display name: "tên tôi là <Tên>"
    if (eventName === "message.text.received" && chatId && typeof text === "string") {
      const raw = text.trim();
      const mm = raw.match(
        /^(?:t[eê]n\s+t[oòóỏõọôồốổỗộơờớởỡợ]i\s+l[aàáảãạâầấẩẫậăằắẳẵặ]|ten\s+toi\s+la)\s+(.+)\s*$/i
      );
      if (mm?.[1]) {
        const nameRaw = String(mm[1] || "").trim().replace(/\s+/g, " ");
        const toTitle = (s) =>
          String(s || "")
            .trim()
            .replace(/\s+/g, " ")
            .split(" ")
            .filter(Boolean)
            .map((w) => {
              const lw = w.toLocaleLowerCase("vi-VN");
              const head = lw.slice(0, 1).toLocaleUpperCase("vi-VN");
              const tail = lw.slice(1);
              return head + tail;
            })
            .join(" ");
        const name = toTitle(nameRaw);

        if (!name) {
          res.status(200).json({ok: true});
          return;
        }

        try {
          linkedProfileCache.delete(chatId);
          await db.collection("zalo_links").doc(chatId).set(
            {
              chatId,
              name,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            {merge: true}
          );
          await sendText(chatId, `OK. Em đã cập nhật tên của bạn là: ${name}`);
        } catch (e) {
          logger.error("update name failed", e);
          await sendText(chatId, "Lỗi khi cập nhật tên.");
        }

        res.status(200).json({ok: true});
        return;
      }
    }

    // Quick link 1 tin: user chỉ cần gửi "ASPxxxx" là liên kết ngay (không cần /link, /id).
    // Link chỉ điều khiển nơi nhận thông báo, không phải xác thực app — nên bỏ bước /id.
    if (eventName === "message.text.received" && chatId && typeof text === "string") {
      const t = text.trim().toUpperCase();
      if (isValidEmployeeCode(t)) {
        try {
          const profile = await getLinkedProfile(chatId);
          if (profile?.memberId) {
            if (profile.memberId === t) {
              await sendText(chatId, `Bạn đã liên kết với mã ${t} rồi.`);
            } else {
              await sendText(chatId, `Chat này đang liên kết mã ${profile.memberId}. Liên hệ quản trị viên nếu cần đổi.`);
            }
            res.status(200).json({ok: true});
            return;
          }
          if (await isMemberLinkedElsewhere(t, chatId)) {
            await sendText(chatId, `Mã ${t} đã liên kết ở chat khác. Liên hệ quản trị viên nếu cần đổi.`);
            res.status(200).json({ok: true});
            return;
          }
          const nameFromDir = await getEmployeeNameFromDirectory(t);
          const name = nameFromDir || t;
          linkedProfileCache.delete(chatId);
          await db.collection("zalo_links").doc(chatId).set(
            {
              chatId,
              name,
              memberId: t,
              source: "zaloWebhook:quicklink",
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            {merge: true}
          );
          await db.collection("zalo_pending").doc(chatId).delete().catch(() => {});
          await sendText(chatId, `Đã liên kết thành công.\nMã: ${t}\nTên: ${name}\nTừ giờ bạn nhận OTP và thông báo kho tại đây.`);
        } catch (e) {
          logger.error("quick link failed", e);
          await sendText(chatId, "Có lỗi khi liên kết. Vui lòng thử lại hoặc liên hệ quản trị viên.");
        }
        res.status(200).json({ok: true});
        return;
      }
    }

    // Log kiểm NVL: "đủ" / "thiếu [ghi chú]" → ghi cho mã vừa tra trong chat này (Zalo KHÔNG gửi kèm tin được rep),
    // hoặc nhắn kèm mã: "đủ B008119 [ghi chú]" / "B008119 đủ [ghi chú]".
    const checkLead = foldedText.match(/^(du|thieu)(?:\s+(.*))?$/);
    const checkTail = checkLead ? null : foldedText.match(/^([a-z0-9][a-z0-9._-]{3,30})\s+(du|thieu)(?:\s+(.*))?$/);
    const checkMatch = checkLead || (checkTail && /\d/.test(checkTail[1]) ? checkTail : null);
    if (eventName === "message.text.received" && chatId && typeof text === "string" && checkMatch) {
      const words = text.trim().split(/\s+/);
      const isCode = (tok) => /^[A-Za-z0-9][A-Za-z0-9._-]{3,30}$/.test(tok || "") && /\d/.test(tok || "");
      let code = "";
      let note = "";
      const status = (checkLead ? checkLead[1] : checkTail[2]) === "du" ? "du" : "thieu";
      if (checkTail) {
        code = words[0];
        note = words.slice(2).join(" ");
      } else if (isCode(words[1])) {
        code = words[1];
        note = words.slice(2).join(" ");
      } else {
        note = words.slice(1).join(" ");
      }
      code = String(code || "").trim().toUpperCase();
      const mentioned = typeof rawText === "string" && rawText.trim().startsWith("@");
      if (!isGroupChat || mentioned) {
        try {
          const linked = (senderId ? await getLinkedProfile(senderId).catch(() => null) : null) ||
            await getLinkedProfile(String(chatId)).catch(() => null);
          const memberId = String(linked?.memberId || "").trim().toUpperCase();
          let last = lastMaterialMem.get(String(chatId)) || null;
          if (!last) {
            const lastSnap = await db.collection("zalo_last_material").doc(String(chatId)).get().catch(() => null);
            if (lastSnap?.exists) last = lastSnap.data() || null;
          }
          const lastMs = typeof last?.atMs === "number" ? last.atMs : (last?.at?.toMillis ? last.at.toMillis() : 0);
          const lastFresh = last && Date.now() - lastMs < 3 * 60 * 60 * 1000;
          if (!code && lastFresh) code = String(last.code || "").toUpperCase();
          if (!memberId) {
            await sendText(chatId, "Chat này chưa liên kết mã nhân viên. Nhắn mã NV (VD: ASP0106) để liên kết, rồi ghi log lại.");
          } else if (!code) {
            await sendText(chatId, "Chưa biết mã nào để ghi log. Tra mã trước (VD: B008119) rồi nhắn «đủ» / «thiếu», hoặc nhắn «đủ B008119».");
          } else {
            const sameAsLast = lastFresh && String(last.code || "").toUpperCase() === code;
            await db.collection("zalo-material-check-log").add({
              materialCode: code,
              status,
              note,
              by: memberId,
              byName: String(linked?.name || "").trim(),
              senderName,
              chatId: String(chatId),
              chatType: chatType || "",
              webTotal: sameAsLast ? String(last.webTotal || "") : "",
              linkQ: sameAsLast ? String(last.linkQ || "") : "",
              at: admin.firestore.FieldValue.serverTimestamp(),
            });
            await sendText(chatId, `📝 Đã ghi log: ${code} – ${status === "du" ? "ĐỦ" : "THIẾU"} (${memberId})${note ? `\nGhi chú: ${note}` : ""}`);
          }
        } catch (err) {
          logger.error("material check log failed", err);
          await sendText(chatId, "Lỗi khi ghi log. Thử lại sau.");
        }
        res.status(200).json({ok: true});
        return;
      }
    }

    // Tồn kho NVL: nhắn mã NVL → tồn; "/standar <mã> <số>" → sửa Standard Packing.
    // Chỉ chat đã liên kết mã NV (zalo_links). Trong nhóm: chỉ khi @bot.
    if (eventName === "message.text.received" && chatId && typeof text === "string") {
      const t = text.trim();
      const standarMatch = t.match(/^\/\s*standa?rd?\s+([A-Za-z0-9][A-Za-z0-9._-]*)\s+([\d.,]+)\s*$/i);
      const isStandarCmd = /^\/\s*standa?rd?\b/i.test(t);
      const looksLikeCode = /^[A-Za-z0-9][A-Za-z0-9._-]{3,30}$/.test(t) && /\d/.test(t) && !isValidEmployeeCode(t);
      const mentioned = typeof rawText === "string" && rawText.trim().startsWith("@");
      if ((isStandarCmd || looksLikeCode) && (!isGroupChat || mentioned)) {
        try {
          const linked = (senderId ? await getLinkedProfile(senderId).catch(() => null) : null) ||
            await getLinkedProfile(String(chatId)).catch(() => null);
          const memberId = String(linked?.memberId || "").trim().toUpperCase();
          if (!memberId) {
            await sendText(chatId, "Chat này chưa liên kết mã nhân viên. Nhắn mã NV (VD: ASP0106) để liên kết, rồi tra lại.");
          } else if (isStandarCmd) {
            const sp = standarMatch ? parseQtyInput(standarMatch[2]) : NaN;
            if (!standarMatch || !(sp > 0)) {
              await sendText(chatId, "Cú pháp: /standar <mã NVL> <số standard mới>\nVD: /standar B008119 500");
            } else {
              await sendText(chatId, await updateStandardFromZalo(standarMatch[1].toUpperCase(), sp, memberId));
            }
          } else {
            const code = t.toUpperCase();
            const parts = await buildMaterialStockMessages(code);
            if (!parts) {
              await sendText(chatId, `Không tìm thấy mã ${code} trong tồn kho hay Danh mục NVL.`);
            } else {
              for (const part of parts) await sendText(chatId, part);
              // Nhớ mã vừa tra → nhắn "đủ" / "thiếu" ngay sau là ghi log cho mã này
              const head = String(parts[0] || "").split("\n").map((x) => x.trim());
              const lastRow = {
                code,
                webTotal: head.find((x) => /^Tổng:/.test(x) || /^Hết tồn kho/.test(x)) || "",
                linkQ: head.filter((x) => /^LinkQ/.test(x)).join("\n"),
                atMs: Date.now(),
              };
              lastMaterialMem.set(String(chatId), lastRow);
              await db.collection("zalo_last_material").doc(String(chatId)).set({
                ...lastRow,
                at: admin.firestore.FieldValue.serverTimestamp(),
              }).catch((e) => logger.warn("save last material failed", e));
            }
          }
        } catch (err) {
          logger.error("material stock command failed", err);
          await sendText(chatId, "Lỗi khi tra tồn kho. Thử lại sau.");
        }
        res.status(200).json({ok: true});
        return;
      }
    }

    res.status(200).json({ok: true});
  }
);
