/**
 * Zalo Bot Platform (Firebase Functions codebase: zalo)
 *
 * Webhook:
 * - Docs: https://bot.zapps.me/docs/webhook/
 * - Verify header: X-Bot-Api-Secret-Token === ZALO_WEBHOOK_SECRET
 *
 * Send message:
 * - Docs: https://bot.zapps.me/docs/apis/sendMessage/
 * - URL: https://bot-api.zaloplatforms.com/bot${BOT_TOKEN}/sendMessage
 *
 * Secrets:
 * - firebase functions:secrets:set ZALO_BOT_TOKEN        (bot token dạng 123:abc...)
 * - firebase functions:secrets:set ZALO_WEBHOOK_SECRET  (secret token bạn nhập trong app bot)
 * - firebase functions:secrets:set NOTIFY_API_KEY       (API key để bạn tự gọi gửi tin)
 */

const {setGlobalOptions} = require("firebase-functions");
const {defineSecret} = require("firebase-functions/params");
const {onRequest} = require("firebase-functions/https");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {runDashboardZaloDigest} = require("./dashboard-digest");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const ZALO_BOT_TOKEN = defineSecret("ZALO_BOT_TOKEN");
const NOTIFY_API_KEY = defineSecret("NOTIFY_API_KEY");
const ZALO_WEBHOOK_SECRET = defineSecret("ZALO_WEBHOOK_SECRET");

const ZALO_BOT_SEND_MESSAGE_URL = (token) =>
  `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/sendMessage`;

setGlobalOptions({maxInstances: 10});

/**
 * API để web/backend của bạn gọi gửi tin qua Zalo Bot Platform.
 *
 * POST JSON: { "chat_id": "<chat.id>", "message": "..." }
 * Header: x-api-key: <NOTIFY_API_KEY>
 */
exports.zaloSendMessage = onRequest(
  {
    secrets: [ZALO_BOT_TOKEN, NOTIFY_API_KEY],
    cors: true,
    invoker: "public",
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    try {
      const apiKey = req.headers["x-api-key"];
      if (apiKey !== NOTIFY_API_KEY.value()) {
        res.status(403).send("Unauthorized");
        return;
      }

      const {chat_id, message} = req.body || {};
      if (!chat_id || message == null || message === "") {
        res.status(400).json({error: "Missing chat_id or message"});
        return;
      }

      const botToken = ZALO_BOT_TOKEN.value();
      const zaloRes = await fetch(ZALO_BOT_SEND_MESSAGE_URL(botToken), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id,
          text: message,
        }),
      });

      const data = await zaloRes.json().catch(() => ({}));
      if (!zaloRes.ok) {
        logger.error("Zalo Bot sendMessage failed", {status: zaloRes.status, data});
      }
      res.status(zaloRes.ok ? 200 : zaloRes.status).json(data);
    } catch (err) {
      logger.error(err);
      res.status(500).send("Error");
    }
  }
);

/**
 * Webhook endpoint để dán vào ô "Webhook URL" trong app Bot.
 * - Verify header: X-Bot-Api-Secret-Token
 * - Log raw payload để bạn copy chat_id
 * - Auto-reply để test: nhắn "/id" -> bot trả về chat_id
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

    /** Trong nhóm: bỏ @tên_bot (có thể nhiều từ, vd "@Bot AI Warehouse dangky quanly"). */
    const extractZaloCommandText = (raw) => {
      const t = String(raw || "").trim();
      if (!t || !t.startsWith("@")) return t;

      const dangky = t.match(/\b(dangky(?:\s+|_)(?:quanly|tbhd|asm1|asm2|asm3))\b/i);
      if (dangky) return dangky[1].replace(/_/g, " ");

      const loOk = t.match(/\b(lo\s+.+?\s+ok)\s*$/i);
      if (loOk) return loOk[1];

      const slashOk = t.match(/(\/\S+\s+ok)\s*$/i);
      if (slashOk) return slashOk[1];

      const slashCmd = t.match(
        /(\/(?:chucnang|link|id|groupid|dangky_quanly|dangky_tbhd|dangky_asm1|dangky_asm2|dangky_asm3)(?:\s+\S+)*)\s*$/i
      );
      if (slashCmd) return slashCmd[1];

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

    const stripAccentsTbhd = (s) =>
      String(s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/gi, "d");

    const normalizeCommandText = (raw) =>
      stripAccentsTbhd(String(raw || "").trim())
        .toLowerCase()
        .replace(/\s+/g, " ");

    const isDangkyQuanlyCommand = (raw) => {
      const t = normalizeCommandText(raw);
      return (
        t === "dangky quanly" ||
        t === "/dangky quanly" ||
        t === "dangky_quanly" ||
        t === "/dangky_quanly" ||
        /\bdangky\s+quanly\s*$/.test(t) ||
        /\bdangky_quanly\s*$/.test(t)
      );
    };

    const isDangkyTbhdCommand = (raw) => {
      const t = normalizeCommandText(raw);
      return (
        t === "dangky tbhd" ||
        t === "/dangky tbhd" ||
        t === "dangky_tbhd" ||
        t === "/dangky_tbhd" ||
        /\bdangky\s+tbhd\s*$/.test(t) ||
        /\bdangky_tbhd\s*$/.test(t)
      );
    };

    const parseDangkyAsmFactory = (raw) => {
      const t = normalizeCommandText(raw);
      const m =
        t.match(/^dangky\s+(asm1|asm2|asm3)\s*$/) ||
        t.match(/^\/dangky\s+(asm1|asm2|asm3)\s*$/) ||
        t.match(/^dangky_(asm1|asm2|asm3)\s*$/) ||
        t.match(/^\/dangky_(asm1|asm2|asm3)\s*$/) ||
        t.match(/\bdangky\s+(asm1|asm2|asm3)\s*$/);
      return m ? m[1].toUpperCase() : "";
    };

    const ASM_KHO_GROUP_DOCS = {
      ASM1: {docId: "kho_asm1", label: "Kho ASM1"},
      ASM2: {docId: "kho_asm2", label: "Kho ASM2"},
      ASM3: {docId: "kho_asm3", label: "Kho ASM3"},
    };

    /** Lô <số lô> ok  |  /<số lô> ok */
    const parseTbhdBatchAck = (raw) => {
      const t = String(raw || "").trim();
      if (!t) return "";
      const loMatch = stripAccentsTbhd(t)
        .toLowerCase()
        .replace(/\s+/g, " ")
        .match(/(?:^|\s)lo\s+(.+?)\s+ok\s*$/);
      if (loMatch?.[1]) return loMatch[1].trim();
      const slashMatch = t.match(/(?:^|\s)\/(.+?)\s+ok\s*$/i);
      if (slashMatch?.[1]) return slashMatch[1].trim();
      return "";
    };

    const tbhdAckDocId = (factory, batchNumber) => {
      const f = String(factory || "").trim().toUpperCase();
      const b = String(batchNumber || "").trim();
      return `${f}__${encodeURIComponent(b)}`;
    };

    const TBHD_GROUP_CONFIG_DOC = "tbhd_ack_nvl";
    const QUANLY_KHO_GROUP_CONFIG_DOC = "quanly_kho";

    const isTbhdGroupRegistered = async (id) => {
      const cid = String(id || "").trim();
      if (!cid) return false;
      try {
        const doc = await db.collection("zalo_group_config").doc(TBHD_GROUP_CONFIG_DOC).get();
        if (!doc.exists) return false;
        const d = doc.data() || {};
        return String(d.chatId || "").trim() === cid && d.purpose === "tbhd_ack";
      } catch (e) {
        logger.error("isTbhdGroupRegistered failed", e);
        return false;
      }
    };

    const findInboundBatchFactories = async (batchNumber) => {
      const bn = String(batchNumber || "").trim();
      if (!bn) return [];
      const factories = [];
      for (const factory of ["ASM1", "ASM2"]) {
        try {
          const snap = await db
            .collection("inbound-materials")
            .where("factory", "==", factory)
            .where("batchNumber", "==", bn)
            .limit(1)
            .get();
          if (!snap.empty) factories.push(factory);
        } catch (e) {
          logger.warn("findInboundBatchFactories query failed", {factory, batchNumber: bn, e});
        }
      }
      return factories;
    };

    const getInboundReceiveSummary = async (factory, batchNumber) => {
      const f = String(factory || "").trim().toUpperCase();
      const bn = String(batchNumber || "").trim();
      if (!f || !bn) return null;
      try {
        const snap = await db
          .collection("inbound-materials")
          .where("factory", "==", f)
          .where("batchNumber", "==", bn)
          .get();
        if (snap.empty) return null;
        let count = 0;
        let receivedCount = 0;
        snap.forEach((doc) => {
          const d = doc.data() || {};
          count++;
          if (d.isReceived === true) receivedCount++;
        });
        return {
          count,
          receivedCount,
          fullyReceived: count > 0 && receivedCount === count,
        };
      } catch (e) {
        logger.warn("getInboundReceiveSummary failed", {factory: f, batchNumber: bn, e});
        return null;
      }
    };

    const isTbhdAckedOnWeb = async (factory, batchNumber) => {
      try {
        const doc = await db.collection("inbound-tbhd-ack").doc(tbhdAckDocId(factory, batchNumber)).get();
        if (!doc.exists) return false;
        return (doc.data() || {}).acknowledged === true;
      } catch {
        return false;
      }
    };

    const buildTbhdGreetingLine = (senderName) => {
      const name = String(senderName || "").trim();
      if (!name) return "";
      return `Chào sếp ${name}, em đã nhận thông tin`;
    };

    const buildTbhdStatusReply = async (batchNumber, factories, senderName = "") => {
      const lines = [];
      const greet = buildTbhdGreetingLine(senderName);
      if (greet) {
        lines.push(greet, "");
      }
      lines.push(`Lô ${batchNumber}:`);
      for (const factory of factories) {
        const receive = await getInboundReceiveSummary(factory, batchNumber);
        const tbhdAcked = await isTbhdAckedOnWeb(factory, batchNumber);

        if (receive?.fullyReceived) {
          lines.push(`✅ ${factory}: đã tick nhập trên web (${receive.receivedCount}/${receive.count} mã).`);
        } else if (receive) {
          lines.push(`⏳ ${factory}: chưa tick nhập trên web (${receive.receivedCount}/${receive.count} mã).`);
        } else {
          lines.push(`⏳ ${factory}: chưa tìm thấy dữ liệu nhập kho.`);
        }

        if (tbhdAcked) {
          lines.push(`✅ ${factory}: đã tick Yes Kiểm Tra TBHD — cần nhập ở LinkQ.`);
        } else {
          lines.push(`⏳ ${factory}: nhân viên kho chưa tick Yes trên màn Kiểm Tra TBHD Inbound.`);
        }
      }
      return lines.join("\n");
    };

    const normalize = (s) => String(s || "").trim();
    const isGreeting = (s) => {
      const t = normalize(s).toLowerCase().replace(/\s+/g, " ");
      return (
        t === "hi" ||
        t === "hello" ||
        t === "helo" ||
        t === "hi cưng" ||
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
      const doc = await db.collection("zalo_links").doc(id).get();
      return doc.exists ? doc.data() : null;
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

    // Pending conversation state (onboarding, scrap, ...)
    if (eventName === "message.text.received" && chatId && typeof text === "string") {
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

    const CHUCNANG_TEXT =
      "Danh sách câu lệnh:\n" +
      "- /tonkho <mã hàng>  (xem vị trí & tồn kho ở ASM1 + ASM2)\n" +
      "- /tonkho ASM1 <mã hàng>\n" +
      "- /tonkho ASM2 <mã hàng>\n" +
      "- /scrap  (tra cứu kho scrap, có password)\n" +
      "- Sau khi có hàng: Xuất <số pcs> (vd: Xuất 100 pcs) → giao việc qua ASP0106\n" +
      "- /link   (liên kết mã nhân viên để nhận thông báo)\n" +
      "- /id     (xem mã nhân viên đã liên kết)\n" +
      "- /groupid (xem chat_id nhóm/cá nhân — dùng khi cấu hình bot)\n" +
      "- @bot dangky tbhd (nhóm Nhập NVL — ASM1+ASM2 chung)\n" +
      "- @bot dangky quanly (đăng ký nhóm Quản lý kho)\n" +
      "- @bot dangky asm1 | dangky asm2 | dangky asm3 (nhóm kho từng xưởng)\n" +
      "- Nhóm TBHD: Lô <số lô> ok (vd: Lô 3834 ok)";

    // Greetings:
    // - Always show intro + guidance
    if (eventName === "message.text.received" && chatId && typeof text === "string" && isGreeting(text)) {
      try {
        await sendText(
          chatId,
          "Xin chào, em là trợ lý kho.\n" +
            "Nếu tìm mã hàng, vui lòng gõ: /tonkho <mã hàng>\n" +
            "Em sẽ hiển thị vị trí hàng để tìm.\n\n" +
            "Nếu có các yêu cầu khác, vui lòng gõ: /chucnang (em sẽ hiển thị danh sách các câu lệnh)."
        );
      } catch (err) {
        logger.error("greeting handler failed", err);
      }
      res.status(200).json({ok: true});
      return;
    }

    if (eventName === "message.text.received" && chatId && typeof text === "string" && text.trim().toLowerCase() === "/chucnang") {
      try {
        await sendText(chatId, CHUCNANG_TEXT);
      } catch (err) {
        logger.error("chucnang command failed", err);
      }
      res.status(200).json({ok: true});
      return;
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
          if (pending?.intent === "link_emp" && isValidEmployeeCode(memberId)) {
            const nameFromDir = await getEmployeeNameFromDirectory(memberId);
            const name = nameFromDir || memberId;
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
              `Đã liên kết thành công.\nMã: ${memberId}\nTên: ${name}\n\nXin chào ${name}.\nGõ: /tonkho <mã hàng> để tìm vị trí.`
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

    // Quick link: user sends "ASPxxxx" then confirms by /id
    // (bỏ qua khi đang giao việc xuất scrap — xử lý ở block /scrap bên dưới)
    if (eventName === "message.text.received" && chatId && typeof text === "string") {
      const t = text.trim().toUpperCase();
      if (isValidEmployeeCode(t)) {
        const pendingForLink = await db
          .collection("zalo_pending")
          .doc(chatId)
          .get()
          .catch(() => null);
        const pendingLink = pendingForLink?.exists ? pendingForLink.data() : null;
        if (pendingLink?.intent === "scrap_export_assign") {
          // fall through → scrap_export_assign handler
        } else {
          try {
            const profile = await getLinkedProfile(chatId);
            if (profile?.memberId) {
              res.status(200).json({ok: true});
              return;
            }
            await db.collection("zalo_pending").doc(chatId).set(
              {intent: "link_emp", step: "confirm", memberId: t, updatedAt: admin.firestore.FieldValue.serverTimestamp()},
              {merge: true}
            );
            await sendText(chatId, `Đã nhận mã ${t}. Vui lòng gõ: /id để xác nhận liên kết.`);
          } catch (e) {
            logger.error("set pending link_emp failed", e);
          }
          res.status(200).json({ok: true});
          return;
        }
      }
    }

    // Command: /scarp (alias /scrap) with password gate (password = 2026)
    // Flow:
    // - User: /scarp  -> bot asks password
    // - User: 2026    -> bot asks material code
    // - User: B001680 -> bot checks scrap store and replies
    const SCRAP_PASSWORD = "2026";
    const SCRAP_AUTH_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
    const SCRAP_COORDINATOR_ID = "ASP0106";
    const SCRAP_EXPORT_UNIT = "pcs";

    const stripAccents = (s) =>
      String(s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/gi, "d");

    /** Lệnh xuất kho scrap: "Xuất 100 pcs" (tồn tra cứu vẫn theo bag). */
    const parseScrapExportQty = (s) => {
      const norm = stripAccents(String(s || "").trim().toLowerCase());
      const withUnit = norm.match(/^xuat\s+(\d+)\s*pcs?\s*$/);
      if (withUnit) {
        const qty = parseInt(withUnit[1], 10);
        return Number.isFinite(qty) && qty > 0 ? qty : null;
      }
      const bare = norm.match(/^xuat\s+(\d+)\s*$/);
      if (bare) {
        const qty = parseInt(bare[1], 10);
        return Number.isFinite(qty) && qty > 0 ? qty : null;
      }
      return null;
    };

    const getZaloLinkByMemberId = async (memberId) => {
      const emp = String(memberId || "").trim().toUpperCase();
      if (!emp) return null;
      try {
        const snap = await db.collection("zalo_links").where("memberId", "==", emp).limit(1).get();
        if (snap.empty) return null;
        const d = snap.docs[0].data() || {};
        return {
          chatId: String(d.chatId || snap.docs[0].id || "").trim(),
          memberId: emp,
          name: String(d.name || "").trim(),
        };
      } catch (e) {
        logger.error("zalo_links lookup failed", e);
        return null;
      }
    };

    const getChatIdByMemberId = async (memberId) => {
      const link = await getZaloLinkByMemberId(memberId);
      return link?.chatId || "";
    };

    const getDisplayNameForMemberId = async (memberId) => {
      const emp = String(memberId || "").trim().toUpperCase();
      if (!emp) return "—";
      const link = await getZaloLinkByMemberId(emp);
      if (link?.name) return link.name;
      const fromDir = await getEmployeeNameFromDirectory(emp);
      return fromDir || emp;
    };

    /** Danh sách NV đã liên kết Zalo (zalo_links) — ASP0106 chọn ID để giao việc xuất scrap. */
    const buildZaloLinksAssigneeListText = async () => {
      try {
        const [linksSnap, dirSnap] = await Promise.all([
          db.collection("zalo_links").limit(300).get(),
          db.collection("employee-directory").limit(500).get().catch(() => null),
        ]);

        const nameById = new Map();
        if (dirSnap && !dirSnap.empty) {
          for (const doc of dirSnap.docs) {
            const d = doc.data() || {};
            const id = String(d.employeeId || doc.id || "").trim().toUpperCase();
            const name = String(d.name || d.employeeName || "").trim();
            if (id && name) nameById.set(id, name);
          }
        }

        if (!linksSnap || linksSnap.empty) {
          return "(Chưa có ai liên kết Zalo — NV cần gõ /link rồi /id trước)";
        }

        const byMember = new Map();
        for (const doc of linksSnap.docs) {
          const d = doc.data() || {};
          const id = String(d.memberId || "").trim().toUpperCase();
          if (!isValidEmployeeCode(id)) continue;
          if (id === SCRAP_COORDINATOR_ID) continue;
          const name = String(d.name || "").trim() || nameById.get(id) || "";
          const chatId = String(d.chatId || doc.id || "").trim();
          const prev = byMember.get(id);
          if (!prev || (name && !prev.name)) {
            byMember.set(id, {id, name, chatId});
          }
        }

        const rows = Array.from(byMember.values()).sort((a, b) =>
          a.id.localeCompare(b.id, "vi")
        );
        if (rows.length === 0) {
          return "(Chưa có NV ASPxxxx liên kết Zalo — trừ điều phối)";
        }

        const lines = rows.slice(0, 40).map((r) => `- ${r.id} — ${r.name || "—"}`);
        const more = rows.length > 40 ? `\n... và ${rows.length - 40} NV khác` : "";
        return `${lines.join("\n")}${more}`;
      } catch (e) {
        logger.error("zalo_links assignee list failed", e);
        return "(Không tải được danh sách zalo_links)";
      }
    };

    const isScrapCommand = (s) => {
      const tt = String(s || "").trim().toLowerCase();
      return tt === "/scarp" || tt.startsWith("/scarp ") || tt === "/scrap" || tt.startsWith("/scrap ");
    };

    const doScrapLookup = async (raw) => {
      const rawCode = String(raw || "").trim();
      if (!rawCode) {
        await sendText(chatId, "Vui lòng nhập mã hàng (ví dụ: B001680).");
        return;
      }
      // UI scrap chỉ lưu 7 ký tự đầu (raw.slice(0,7))
      const code7 = rawCode.toUpperCase().slice(0, 7);
      try {
        // Avoid composite-index requirement (array-contains + orderBy).
        const snap = await db
          .collection("scrap-data")
          .where("materials", "array-contains", code7)
          .limit(20)
          .get();

        const pendingRef = db.collection("zalo_pending").doc(chatId);

        if (snap.empty) {
          await pendingRef.set(
            {lastScrapCode7: admin.firestore.FieldValue.delete(), lastScrapTotalBags: admin.firestore.FieldValue.delete()},
            {merge: true}
          );
          await sendText(chatId, `Kho scrap: KHÔNG có mã ${code7}.`);
          return;
        }

        const boxCounts = new Map();
        let totalBags = 0;
        for (const doc of snap.docs) {
          const d = doc.data() || {};
          const boxCode = String(d.boxCode || "").trim();
          const materials = Array.isArray(d.materials) ? d.materials : [];
          const bags = materials.filter((x) => String(x || "").toUpperCase().slice(0, 7) === code7).length;
          totalBags += bags;
          if (boxCode) boxCounts.set(boxCode, (boxCounts.get(boxCode) || 0) + bags);
        }

        const boxes = Array.from(boxCounts.entries())
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "vi"))
          .slice(0, 8)
          .map(([box, bags]) => `- ${box}: ${bags} bag`)
          .join("\n");

        await pendingRef.set(
          {lastScrapCode7: code7, lastScrapTotalBags: totalBags, updatedAt: admin.firestore.FieldValue.serverTimestamp()},
          {merge: true}
        );

        await sendText(
          chatId,
          `Kho scrap: CÓ mã ${code7}.\nTổng tồn (ước tính): ${totalBags} bag.\nThùng:\n${boxes || "—"}\n\n` +
            `Tồn đếm theo bag; yêu cầu xuất theo pcs.\n` +
            `Cần xuất: gõ "Xuất <số pcs>" (vd: Xuất 100 pcs).`
        );
      } catch (err) {
        logger.error("scrap lookup failed", err);
        await sendText(chatId, "Lỗi khi tra cứu kho scrap.");
      }
    };

    const createScrapExportRequest = async (requesterChatId, materialCode, quantity, requesterProfile) => {
      const requesterMemberId = String(requesterProfile?.memberId || "").trim().toUpperCase();
      const requesterName = String(requesterProfile?.name || requesterMemberId || "—").trim();
      const reqRef = await db.collection("scrap-export-requests").add({
        materialCode,
        quantity,
        unit: SCRAP_EXPORT_UNIT,
        requesterMemberId: requesterMemberId || "",
        requesterName,
        requesterChatId,
        status: "pending_assign",
        coordinatorMemberId: SCRAP_COORDINATOR_ID,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const coordinatorChatId = await getChatIdByMemberId(SCRAP_COORDINATOR_ID);
      if (!coordinatorChatId) {
        await sendText(
          requesterChatId,
          `Đã ghi yêu cầu xuất ${quantity} ${SCRAP_EXPORT_UNIT} (mã ${materialCode}), nhưng chưa liên kết Zalo ${SCRAP_COORDINATOR_ID}.`
        );
        return;
      }

      const empList = await buildZaloLinksAssigneeListText();
      const coordPendingRef = db.collection("zalo_pending").doc(coordinatorChatId);
      await coordPendingRef.set(
        {
          intent: "scrap_export_assign",
          step: "pick_worker",
          requestId: reqRef.id,
          materialCode,
          quantity,
          unit: SCRAP_EXPORT_UNIT,
          requesterMemberId,
          requesterName,
          requesterChatId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        {merge: true}
      );

      await sendText(
        coordinatorChatId,
        `📦 Yêu cầu xuất kho scrap\n` +
          `Mã NVL: ${materialCode}\n` +
          `Số lượng xuất: ${quantity} ${SCRAP_EXPORT_UNIT}\n` +
          `(Tồn kho tra cứu theo bag — NV nhận việc tự quy đổi/xử lý.)\n` +
          `Người yêu cầu: ${requesterMemberId || "—"} — ${requesterName}\n\n` +
          `Danh sách NV đã liên kết Zalo (chỉ cần nhập ID):\n${empList}\n\n` +
          `👉 Nhập mã ASPxxxx (vd: ASP0123) để giao việc xuất kho scrap.`
      );

      await sendText(
        requesterChatId,
        `Đã gửi yêu cầu xuất kho scrap (${quantity} ${SCRAP_EXPORT_UNIT}, mã ${materialCode}) tới ${SCRAP_COORDINATOR_ID}. Chờ phân công.`
      );
    };

    if (eventName === "message.text.received" && chatId && typeof text === "string") {
      const t = text.trim();
      const pendingRef = db.collection("zalo_pending").doc(chatId);
      const pendingSnap = await pendingRef.get().catch(() => null);
      const pending = pendingSnap?.exists ? pendingSnap.data() : null;

      const authedUntilMs = pending?.scrapAuthedUntilMs ? Number(pending.scrapAuthedUntilMs) : 0;
      const isAuthed = Number.isFinite(authedUntilMs) && authedUntilMs > Date.now();

      // ASP0106: chọn NV thực hiện xuất scrap
      if (pending?.intent === "scrap_export_assign" && pending?.step === "pick_worker") {
        const workerId = t.toUpperCase();
        if (!isValidEmployeeCode(workerId)) {
          await sendText(chatId, "Mã chưa đúng. Nhập ID dạng ASP + 4 số (vd: ASP0123).");
          res.status(200).json({ok: true});
          return;
        }
        if (workerId === SCRAP_COORDINATOR_ID) {
          await sendText(
            chatId,
            `Không giao xuất kho scrap cho chính ${SCRAP_COORDINATOR_ID}. Chọn ID NV khác trong danh sách zalo_links.`
          );
          res.status(200).json({ok: true});
          return;
        }

        const requestId = String(pending.requestId || "").trim();
        const materialCode = String(pending.materialCode || "").trim();
        const quantity = Number(pending.quantity || 0);
        const requesterChatId = String(pending.requesterChatId || "").trim();
        const requesterName = String(pending.requesterName || "").trim();
        const requesterMemberId = String(pending.requesterMemberId || "").trim();

        const workerName = await getDisplayNameForMemberId(workerId);
        const workerChatId = await getChatIdByMemberId(workerId);

        if (requestId) {
          await db
            .collection("scrap-export-requests")
            .doc(requestId)
            .set(
              {
                status: "assigned",
                assigneeMemberId: workerId,
                assigneeName: workerName,
                assignedAt: admin.firestore.FieldValue.serverTimestamp(),
                assignedBy: SCRAP_COORDINATOR_ID,
              },
              {merge: true}
            )
            .catch((e) => logger.error("scrap-export-requests update failed", e));
        }

        const exportUnit = String(pending.unit || SCRAP_EXPORT_UNIT).trim() || SCRAP_EXPORT_UNIT;

        const taskMsg =
          `📦 Lệnh xuất kho scrap\n` +
          `Mã NVL: ${materialCode}\n` +
          `Số lượng xuất: ${quantity} ${exportUnit}\n` +
          `Người yêu cầu: ${requesterMemberId || "—"} — ${requesterName}\n` +
          `Điều phối: ${SCRAP_COORDINATOR_ID}\n\n` +
          `(Tồn kho scrap đếm theo bag — anh/chị tự quy đổi và xử lý xuất.)\n\n` +
          `Vui lòng thực hiện xuất kho scrap theo yêu cầu trên.`;

        const assignSummary =
          `xuất kho scrap — ${quantity} ${exportUnit}, mã NVL ${materialCode}`;

        if (workerChatId) {
          await sendText(workerChatId, taskMsg);
          await sendText(
            chatId,
            `✅ Đã giao ${workerId} (${workerName}) ${assignSummary}. Đã gửi Zalo cho NV.`
          );
        } else {
          await sendText(
            chatId,
            `⚠️ Đã ghi nhận giao ${workerId} (${workerName}) ${assignSummary}, nhưng NV chưa liên kết Zalo (/link).`
          );
        }

        if (requesterChatId && requesterChatId !== chatId) {
          await sendText(
            requesterChatId,
            `✅ ${SCRAP_COORDINATOR_ID} đã giao ${workerId} (${workerName}) ${assignSummary}.`
          );
        }

        await pendingRef
          .set(
            {
              intent: admin.firestore.FieldValue.delete(),
              step: admin.firestore.FieldValue.delete(),
              requestId: admin.firestore.FieldValue.delete(),
              materialCode: admin.firestore.FieldValue.delete(),
              quantity: admin.firestore.FieldValue.delete(),
              requesterChatId: admin.firestore.FieldValue.delete(),
              requesterName: admin.firestore.FieldValue.delete(),
              requesterMemberId: admin.firestore.FieldValue.delete(),
            },
            {merge: true}
          )
          .catch(() => {});

        res.status(200).json({ok: true});
        return;
      }

      // Lệnh xuất: "Xuất 100 pcs" (sau tra cứu /scrap)
      const exportQty = parseScrapExportQty(t);
      if (exportQty != null) {
        if (!isAuthed) {
          await sendText(chatId, "Hết hạn tra cứu scrap. Gõ /scrap và nhập password trước.");
          res.status(200).json({ok: true});
          return;
        }
        const code7 = String(pending?.lastScrapCode7 || "").trim().toUpperCase();
        if (!code7) {
          await sendText(
            chatId,
            "Chưa có mã hàng vừa tra. Dùng /scrap, tra mã có hàng, rồi gõ Xuất <số pcs> (vd: Xuất 100 pcs)."
          );
          res.status(200).json({ok: true});
          return;
        }
        const profile = await getLinkedProfile(chatId);
        try {
          await createScrapExportRequest(chatId, code7, exportQty, profile);
        } catch (e) {
          logger.error("scrap export request failed", e);
          await sendText(chatId, "Lỗi khi tạo yêu cầu xuất. Thử lại sau.");
        }
        res.status(200).json({ok: true});
        return;
      }

      // Start /scrap or /scarp
      if (isScrapCommand(t)) {
        const parts = t.split(/\s+/g).filter(Boolean);
        const inlineCode = parts[1] || "";

        if (!isAuthed) {
          await pendingRef.set(
            { intent: "scrap", step: "password", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
          await sendText(chatId, "Nhập password để tra cứu kho scrap.");
          res.status(200).json({ ok: true });
          return;
        }

        // Already authed
        if (inlineCode) {
          await doScrapLookup(inlineCode);
        } else {
          await pendingRef.set(
            { intent: "scrap", step: "code", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
          await sendText(chatId, "Nhập mã hàng cần tra cứu kho scrap (ví dụ: B001680).");
        }
        res.status(200).json({ ok: true });
        return;
      }

      // Continue scrap flow
      if (pending?.intent === "scrap" && pending?.step === "password") {
        if (t === SCRAP_PASSWORD) {
          await pendingRef.set(
            {
              scrapAuthedUntilMs: Date.now() + SCRAP_AUTH_TTL_MS,
              intent: "scrap",
              step: "code",
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          await sendText(chatId, "OK. Nhập mã hàng cần tra cứu kho scrap (ví dụ: B001680).");
        } else {
          await sendText(chatId, "Sai password. Vui lòng nhập lại.");
        }
        res.status(200).json({ ok: true });
        return;
      }

      if (pending?.intent === "scrap" && pending?.step === "code") {
        if (!isAuthed) {
          await pendingRef.set({ intent: "scrap", step: "password" }, { merge: true });
          await sendText(chatId, "Hết hạn. Nhập lại password để tra cứu kho scrap.");
          res.status(200).json({ ok: true });
          return;
        }
        await doScrapLookup(t);
        // keep auth, end intent
        await pendingRef
          .set({ intent: admin.firestore.FieldValue.delete(), step: admin.firestore.FieldValue.delete() }, { merge: true })
          .catch(() => {});
        res.status(200).json({ ok: true });
        return;
      }
    }

    // Command: /tonkho <MA_HANG> (mặc định xem cả ASM1 + ASM2)
    // Optional: /tonkho ASM1 <MA_HANG> hoặc /tonkho ASM2 <MA_HANG>
    // Data source matches Angular tabs: collection `inventory-materials` with fields:
    // - factory: "ASM1" | "ASM2"
    // - materialCode: string
    // - quantity: number (fallbacks supported below)
    if (eventName === "message.text.received" && chatId && typeof text === "string") {
      const t = text.trim();

      const buildTonkhoReplyFor = async (factory, code) => {
        const snap = await db
          .collection("inventory-materials")
          .where("factory", "==", factory)
          .where("materialCode", "==", code)
          .limit(20)
          .get();

        if (snap.empty) return {factory, ok: false, total: 0, lines: []};

        let total = 0;
        const lines = [];
        for (const doc of snap.docs) {
          const d = doc.data() || {};
          // Match Angular column "Tồn kho":
          // (openingStock || 0) + (quantity || 0) - (exported || 0) - (xt || 0)
          const qty =
            (Number(d.openingStock || 0) || 0) +
            (Number(d.quantity || 0) || 0) -
            (Number(d.exported || 0) || 0) -
            (Number(d.xt || 0) || 0);
          total += qty || 0;
          const po = d.poNumber || d.po || "";
          const loc = d.location || "";
          const batch = d.batchNumber || "";
          const extra = [po && `PO:${po}`, loc && `Vị trí:${loc}`, batch && `Lot:${batch}`]
            .filter(Boolean)
            .join(" | ");
          lines.push(`- ${qty}${extra ? ` (${extra})` : ""}`);
          if (lines.length >= 8) break;
        }
        return {factory, ok: true, total, lines};
      };

      const handleTonkho = async (code, factories) => {
        try {
          const codeNorm = String(code || "").trim().toUpperCase();
          if (!codeNorm) {
            await sendText(chatId, "Vui lòng nhập mã hàng (ví dụ: B001680).");
            return;
          }

          const targets =
            Array.isArray(factories) && factories.length > 0 ? factories : ["ASM1", "ASM2"];
          const results = await Promise.all(targets.map((fac) => buildTonkhoReplyFor(fac, codeNorm)));
          const found = results.filter((r) => r.ok);
          if (found.length === 0) {
            await sendText(chatId, `Không tìm thấy tồn cho ${codeNorm} (ASM1/ASM2).`);
            return;
          }
          const header = `Tồn kho\nMã: ${codeNorm}\n`;
          const blocks = found
            .map((r) => {
              const details = r.lines && r.lines.length ? `Chi tiết:\n${r.lines.join("\n")}` : "";
              return `---\n${r.factory}\nTổng: ${r.total}\n${details}`.trim();
            })
            .join("\n\n");
          await sendText(chatId, `${header}\n${blocks}`.trim());
        } catch (err) {
          logger.error("tonkho failed", err);
          await sendText(chatId, "Lỗi khi kiểm tra tồn kho.");
        }
      };

      // Quick search: user sends material code only (e.g. B001003)
      if (/^[AB]\d{6}$/i.test(t)) {
        await handleTonkho(t, ["ASM1", "ASM2"]);
        res.status(200).json({ok: true});
        return;
      }

      // Natural text: "tồn kho B001680" (accepts without accents too)
      const m = t.match(/^(?:t[oòóỏõọôồốổỗộơờớởỡợ]n\\s+kho|ton\\s+kho)\\s+([A-Za-z0-9._-]+)\\s*$/i);
      if (m?.[1]) {
        await handleTonkho(m[1], ["ASM1", "ASM2"]);
        res.status(200).json({ok: true});
        return;
      }

      if (t.toLowerCase().startsWith("/tonkho")) {
        const parts = t.split(/\s+/g).filter(Boolean);
        const p1 = (parts[1] || "").trim();
        const p2 = (parts[2] || "").trim();
        const maybeFactory = p1.toUpperCase();
        const fac = ["ASM1", "ASM2"].includes(maybeFactory) ? maybeFactory : "";
        const code = fac ? p2 : p1;
        const factories = fac ? [fac] : ["ASM1", "ASM2"];

        if (!code) {
          await sendText(chatId, "Cú pháp:\n/tonkho <MA_HANG>\nhoặc\n/tonkho ASM1 <MA_HANG>\nhoặc\n/tonkho ASM2 <MA_HANG>");
          res.status(200).json({ok: true});
          return;
        }

        await handleTonkho(code, factories);
        res.status(200).json({ok: true});
        return;
      }
    }

    if (eventName === "message.text.received" && chatId && typeof text === "string" && text.trim().toLowerCase() === "/groupid") {
      try {
        await sendText(
          chatId,
          `Chat ID: ${chatId}\n` +
            `Loại: ${chatType || "—"} (GROUP = nhóm Zalo)\n\n` +
            `Đăng ký nhóm TBHD (ASM1 + ASM2 chung):\n` +
            `Đăng ký nhóm (gõ @tên_bot + lệnh):\n` +
            `• dangky tbhd — nhóm Nhập NVL\n` +
            `• dangky quanly — nhóm Quản lý kho\n` +
            `• dangky asm1 | dangky asm2 | dangky asm3 — nhóm kho từng xưởng\n` +
            `• Nhóm TBHD: Lô <số lô> ok`
        );
      } catch (err) {
        logger.error("groupid command failed", err);
      }
      res.status(200).json({ok: true});
      return;
    }

    if (eventName === "message.text.received" && chatId && typeof text === "string") {
      if (isDangkyQuanlyCommand(text) || isDangkyQuanlyCommand(rawText)) {
        try {
          await db
            .collection("zalo_group_config")
            .doc(QUANLY_KHO_GROUP_CONFIG_DOC)
            .set(
              {
                chatId,
                chatType: chatType || "",
                label: "Quản lý kho",
                purpose: "quanly_kho",
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              {merge: true}
            );
          await sendText(
            chatId,
            `✅ Đã xác nhận: đây là nhóm Quản lý kho.\n\n` +
              `Chat ID nhóm: ${chatId}\n` +
              `Loại: ${chatType || "—"}\n\n` +
              `ID đã lưu — dùng cho các nhiệm vụ bot sau này.\n\n` +
              `Lưu ý nhóm Zalo: gõ @tên bot + lệnh (vd: @bot dangky quanly).`
          );
          logger.info("quanly_kho group registered", {chatId, chatType});
        } catch (e) {
          logger.error("dangky_quanly failed", e);
          await sendText(chatId, "Lỗi đăng ký nhóm Quản lý kho.");
        }
        res.status(200).json({ok: true});
        return;
      }
    }

    if (eventName === "message.text.received" && chatId && typeof text === "string") {
      const asmFactory = parseDangkyAsmFactory(text) || parseDangkyAsmFactory(rawText);
      if (asmFactory && ASM_KHO_GROUP_DOCS[asmFactory]) {
        const cfg = ASM_KHO_GROUP_DOCS[asmFactory];
        try {
          await db
            .collection("zalo_group_config")
            .doc(cfg.docId)
            .set(
              {
                chatId,
                chatType: chatType || "",
                factory: asmFactory,
                label: cfg.label,
                purpose: `kho_${asmFactory.toLowerCase()}`,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              {merge: true}
            );
          await sendText(
            chatId,
            `✅ Đã xác nhận: đây là nhóm ${cfg.label}.\n\n` +
              `Chat ID nhóm: ${chatId}\n` +
              `Xưởng: ${asmFactory}\n` +
              `Loại: ${chatType || "—"}\n\n` +
              `ID đã lưu — dùng cho thông báo bot tới kho ${asmFactory}.\n\n` +
              `Lưu ý: gõ @tên bot + lệnh (vd: @bot dangky ${asmFactory.toLowerCase()}).`
          );
          logger.info("kho_asm group registered", {chatId, chatType, factory: asmFactory});
        } catch (e) {
          logger.error("dangky_asm failed", {factory: asmFactory, e});
          await sendText(chatId, `Lỗi đăng ký nhóm ${cfg.label}.`);
        }
        res.status(200).json({ok: true});
        return;
      }
    }

    if (eventName === "message.text.received" && chatId && typeof text === "string") {
      if (isDangkyTbhdCommand(text) || isDangkyTbhdCommand(rawText)) {
        try {
          await db
            .collection("zalo_group_config")
            .doc(TBHD_GROUP_CONFIG_DOC)
            .set(
              {
                chatId,
                chatType: chatType || "",
                label: "Nhập NVL",
                factories: ["ASM1", "ASM2"],
                purpose: "tbhd_ack",
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              {merge: true}
            );
          await sendText(
            chatId,
            `✅ Đã đăng ký nhóm này đọc TBHD (ASM1 + ASM2 chung).\n\n` +
              `Cú pháp (không cần @bot):\n` +
              `• Lô <số lô> ok\n` +
              `• /<số lô> ok\n\n` +
              `Ví dụ: Lô 3834 ok\n\n` +
              `Bot kiểm tra: (1) đã tick nhập trên web chưa, (2) nhân viên kho đã tick Yes Kiểm Tra TBHD chưa.`
          );
        } catch (e) {
          logger.error("dangky_tbhd failed", e);
          await sendText(chatId, "Lỗi đăng ký nhóm TBHD.");
        }
        res.status(200).json({ok: true});
        return;
      }
    }

    // Nhóm Nhập NVL (ASM1+ASM2): Lô <số lô> ok — chỉ tra cứu, không ghi tick
    if (eventName === "message.text.received" && chatId && typeof text === "string") {
      const batchNumber = parseTbhdBatchAck(text) || parseTbhdBatchAck(rawText);
      if (batchNumber) {
        try {
          const registered = await isTbhdGroupRegistered(chatId);
          if (!registered) {
            logger.info("TBHD status ignored — chat not registered", {chatId, chatType, batchNumber});
            res.status(200).json({ok: true});
            return;
          }

          const factories = await findInboundBatchFactories(batchNumber);
          if (!factories.length) {
            const greeting = buildTbhdGreetingLine(senderName);
            const prefix = greeting ? `${greeting}\n\n` : "";
            await sendText(chatId, `${prefix}Không tìm thấy lô ${batchNumber} trên inbound ASM1/ASM2.`);
            res.status(200).json({ok: true});
            return;
          }

          const replyText = await buildTbhdStatusReply(batchNumber, factories, senderName);
          await sendText(chatId, replyText);
          logger.info("TBHD status checked", {
            batchNumber,
            factories,
            chatId,
            senderName,
            senderId,
          });
        } catch (e) {
          logger.error("TBHD status check failed", e);
          await sendText(chatId, "Lỗi khi kiểm tra TBHD. Thử lại sau.");
        }
        res.status(200).json({ok: true});
        return;
      }
    }

    // (Deprecated) Link by 2-line message. Disabled by request:
    // Linking is now: send employee code (ASPxxxx) then /id to confirm.

    res.status(200).json({ok: true});
  }
);

/**
 * Web/backend gọi API này để gửi thông báo theo memberId (đã link từ webhook).
 *
 * POST JSON: { "memberId": "NV001", "message": "..." }
 * Header: x-api-key: <NOTIFY_API_KEY>
 */
exports.notifyByMemberId = onRequest(
  {
    secrets: [NOTIFY_API_KEY, ZALO_BOT_TOKEN],
    cors: true,
    invoker: "public",
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const apiKey = req.headers["x-api-key"];
    if (apiKey !== NOTIFY_API_KEY.value()) {
      res.status(403).send("Unauthorized");
      return;
    }

    const {memberId, message} = req.body || {};
    if (!memberId || message == null || message === "") {
      res.status(400).json({error: "Missing memberId or message"});
      return;
    }

    try {
      const snap = await db
        .collection("zalo_links")
        .where("memberId", "==", String(memberId))
        .limit(1)
        .get();

      if (snap.empty) {
        res.status(404).json({error: "Member not linked to Zalo chat"});
        return;
      }

      const doc = snap.docs[0].data();
      const chatId = doc.chatId;
      const botToken = ZALO_BOT_TOKEN.value();
      const zaloRes = await fetch(ZALO_BOT_SEND_MESSAGE_URL(botToken), {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({chat_id: chatId, text: message}),
      });
      const data = await zaloRes.json().catch(() => ({}));
      res.status(zaloRes.ok ? 200 : zaloRes.status).json(data);
    } catch (err) {
      logger.error(err);
      res.status(500).json({error: "notifyByMemberId failed"});
    }
  }
);

/**
 * Firestore trigger: when UI detects outbound duplicates, notify fixed members.
 *
 * Collection written by UI: `zalo_alerts`
 * Payload: { type: 'outbound_duplicate_detected', dupes: [{dupKey,count,...}], createdAt }
 *
 * Rule requested: notify ASP0106 and ASP0701.
 */
exports.notifyOutboundDuplicates = onDocumentCreated(
  {
    document: "zalo_alerts/{alertId}",
    secrets: [ZALO_BOT_TOKEN],
    region: "us-central1",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};
    if (data.type !== "outbound_duplicate_detected") return;

    const dupes = Array.isArray(data.dupes) ? data.dupes : [];
    if (dupes.length === 0) return;

    const stateRef = db.collection("zalo_alert_state").doc("outbound_duplicates");
    const stateSnap = await stateRef.get();
    const state = stateSnap.exists ? (stateSnap.data() || {}) : {};
    const prev = (state.lastNotifiedCounts && typeof state.lastNotifiedCounts === "object")
      ? state.lastNotifiedCounts
      : {};

    // Determine which dupKeys are new/increased
    const changed = [];
    const nextCounts = {...prev};
    for (const d of dupes) {
      const key = String(d?.dupKey || "").trim();
      const count = Number(d?.count || 0) || 0;
      if (!key || count <= 1) continue;
      const before = Number(prev[key] || 0) || 0;
      if (count > before) {
        changed.push({
          dupKey: key,
          factory: d.factory,
          materialCode: d.materialCode,
          poNumber: d.poNumber,
          imd: d.imd,
          bagBatch: d.bagBatch,
          count,
          before,
        });
      }
      if (count > before) nextCounts[key] = count;
    }

    // Always update state (even if no changed) to avoid re-notify on same scan
    await stateRef.set(
      {
        lastNotifiedCounts: nextCounts,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      {merge: true}
    );

    if (changed.length === 0) return;

    const botToken = ZALO_BOT_TOKEN.value();
    const memberIds = ["ASP0106", "ASP0701"];

    const linkSnap = await db
      .collection("zalo_links")
      .where("memberId", "in", memberIds)
      .get()
      .catch((e) => {
        logger.error("lookup zalo_links failed", e);
        return null;
      });

    const chatIds = [];
    if (linkSnap && !linkSnap.empty) {
      for (const doc of linkSnap.docs) {
        const v = doc.data() || {};
        if (v.chatId) chatIds.push(String(v.chatId));
      }
    }

    if (chatIds.length === 0) {
      logger.warn("No chatId found for memberIds", {memberIds});
      return;
    }

    const top = changed.slice(0, 8);
    const lines = top.map((c) => {
      const mc = String(c.materialCode || "").toUpperCase();
      const fac = String(c.factory || "");
      const po = c.poNumber ? ` PO:${c.poNumber}` : "";
      const imd = c.imd ? ` IMD:${c.imd}` : "";
      const bag = c.bagBatch ? ` BAG:${c.bagBatch}` : "";
      const delta = c.before ? ` (${c.before}→${c.count})` : ` (${c.count})`;
      return `- ${fac} ${mc}${po}${imd}${bag}${delta}`;
    });
    const msg =
      `⚠️ Phát hiện trùng xuất kho (${changed.length} nhóm mới/tăng).\n` +
      lines.join("\n") +
      (changed.length > top.length ? `\n... +${changed.length - top.length} nhóm` : "");

    await Promise.all(
      chatIds.map((chatId) =>
        fetch(ZALO_BOT_SEND_MESSAGE_URL(botToken), {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({chat_id: chatId, text: msg}),
        }).catch((e) => logger.error("sendMessage failed", e))
      )
    );
  }
);

/**
 * Firestore trigger: khi Angular ghi vào `putaway-assignments/{id}`,
 * gửi Zalo cho danh sách nhân viên được chọn.
 *
 * Payload: { factory, memberIds: string[], materials: string[], createdAt }
 */
exports.notifyPutawayAssignment = onDocumentCreated(
  {
    document: "putaway-assignments/{assignId}",
    secrets: [ZALO_BOT_TOKEN],
    region: "us-central1",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};

    const factory = String(data.factory || "").trim();
    const memberIds = Array.isArray(data.memberIds) ? data.memberIds.map(String) : [];
    const materials = Array.isArray(data.materials) ? data.materials.map(String) : [];

    if (!memberIds.length || !materials.length) return;

    // Resolve chatIds từ zalo_links
    const linkSnap = await db
      .collection("zalo_links")
      .where("memberId", "in", memberIds.slice(0, 10))
      .get()
      .catch((e) => { logger.error("putaway: lookup zalo_links failed", e); return null; });

    if (!linkSnap || linkSnap.empty) {
      logger.warn("putaway: no chatId found", {memberIds});
      return;
    }

    const chatIds = linkSnap.docs
      .map((d) => String((d.data() || {}).chatId || "").trim())
      .filter(Boolean);

    if (!chatIds.length) return;

    const now = new Date();
    const dateStr = now.toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour12: false,
    });
    const matList = materials.map((m) => `"${m}"`).join("\n");
    const msg =
      `Vui lòng cất mã nguyên liệu:\n` +
      `${matList}\n\n` +
      `Thời gian gửi:\n${dateStr}`;

    const botToken = ZALO_BOT_TOKEN.value();
    await Promise.all(
      chatIds.map((chatId) =>
        fetch(ZALO_BOT_SEND_MESSAGE_URL(botToken), {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({chat_id: chatId, text: msg}),
        }).catch((e) => logger.error("putaway: sendMessage failed", {chatId, e}))
      )
    );

    logger.info("putaway: sent to", {memberIds, factory, count: materials.length});
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Putaway reminder: kiểm tra mã hàng đã được giao nhưng vị trí vẫn là IQC
// Gửi báo cáo tổng hợp theo nhân viên tới ASP0106
// Schedule: 11:16 và 16:18 (Asia/Ho_Chi_Minh) hàng ngày
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lấy chatId của ASP0106 từ zalo_links, dùng chung cho 2 reminder.
 */
async function getAsp0106ChatId() {
  const snap = await db
    .collection("zalo_links")
    .where("memberId", "==", "ASP0106")
    .limit(1)
    .get();
  if (snap.empty) return null;
  return String((snap.docs[0].data() || {}).chatId || "").trim() || null;
}

/**
 * Core logic: lấy putaway-assignments (7 ngày gần nhất), kiểm tra xem materialCode
 * nào vẫn còn tồn kho tại vị trí IQC* → tổng hợp theo nhân viên → gửi cho ASP0106.
 */
async function runPutawayReminder(botToken) {
  const chatId = await getAsp0106ChatId();
  if (!chatId) {
    logger.warn("putaway-reminder: không tìm được chatId ASP0106");
    return;
  }

  // Lấy assignments trong 7 ngày qua
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const assignSnap = await db
    .collection("putaway-assignments")
    .where("createdAt", ">=", since)
    .get()
    .catch((e) => { logger.error("putaway-reminder: query assignments failed", e); return null; });

  if (!assignSnap || assignSnap.empty) {
    logger.info("putaway-reminder: không có assignment nào trong 7 ngày qua");
    return;
  }

  // Map: materialCode → Set<memberId>
  const materialToEmployees = new Map();
  const factorySet = new Set();

  for (const doc of assignSnap.docs) {
    const d = doc.data() || {};
    const factory = String(d.factory || "ASM1").trim();
    const materials = Array.isArray(d.materials) ? d.materials.map(String) : [];
    const memberIds = Array.isArray(d.memberIds) ? d.memberIds.map(String) : [];
    factorySet.add(factory);
    for (const mat of materials) {
      if (!materialToEmployees.has(mat)) {
        materialToEmployees.set(mat, { employees: new Set(), factory });
      }
      for (const emp of memberIds) {
        materialToEmployees.get(mat).employees.add(emp);
      }
    }
  }

  if (!materialToEmployees.size) return;

  // Kiểm tra từng factory xem materialCode còn ở IQC không
  const stillAtIqc = new Map(); // materialCode → { employees: Set, factory }

  for (const factory of factorySet) {
    // Query inventory-materials có location bắt đầu bằng IQC (uppercase + lowercase)
    const [snapUpper, snapLower] = await Promise.all([
      db.collection("inventory-materials")
        .where("factory", "==", factory)
        .where("location", ">=", "IQC")
        .where("location", "<", "IQD")
        .get()
        .catch(() => null),
      db.collection("inventory-materials")
        .where("factory", "==", factory)
        .where("location", ">=", "iqc")
        .where("location", "<", "iqd")
        .get()
        .catch(() => null),
    ]);

    const codesAtIqc = new Set();
    for (const snap of [snapUpper, snapLower]) {
      if (!snap || snap.empty) continue;
      for (const doc of snap.docs) {
        const mc = String((doc.data() || {}).materialCode || "").toUpperCase().trim();
        if (mc) codesAtIqc.add(mc);
      }
    }

    // Giao nhau: mã được giao VÀ vẫn còn ở IQC
    for (const [mat, info] of materialToEmployees.entries()) {
      if (info.factory !== factory) continue;
      const matUpper = mat.toUpperCase().trim();
      if (codesAtIqc.has(matUpper)) {
        stillAtIqc.set(matUpper, info);
      }
    }
  }

  if (!stillAtIqc.size) {
    logger.info("putaway-reminder: tất cả mã đã được cất, không cần nhắc");
    return;
  }

  // Tổng hợp theo nhân viên
  const empToMaterials = new Map(); // memberId → Set<materialCode>
  for (const [mat, info] of stillAtIqc.entries()) {
    for (const emp of info.employees) {
      if (!empToMaterials.has(emp)) empToMaterials.set(emp, new Set());
      empToMaterials.get(emp).add(mat);
    }
  }

  const now = new Date();
  const dateStr = now.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour12: false,
  });

  const lines = [];
  for (const [emp, mats] of empToMaterials.entries()) {
    lines.push(`👤 ${emp} (${mats.size} mã):`);
    for (const m of mats) lines.push(`   • ${m}`);
  }

  const msg =
    `⏰ Nhắc cất NVL — ${dateStr}\n` +
    `Có ${stillAtIqc.size} mã hàng đã được giao nhưng vị trí vẫn là IQC:\n\n` +
    lines.join("\n") +
    `\n\nVui lòng nhắc nhở nhân viên hoàn thành cất kho.`;

  await fetch(ZALO_BOT_SEND_MESSAGE_URL(botToken), {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({chat_id: chatId, text: msg}),
  }).catch((e) => logger.error("putaway-reminder: sendMessage failed", e));

  logger.info("putaway-reminder: sent report", {
    stillAtIqcCount: stillAtIqc.size,
    employeeCount: empToMaterials.size,
  });
}

/** 11:16 (Asia/Ho_Chi_Minh) hàng ngày */
exports.putawayReminderAt1116 = onSchedule(
  {
    schedule: "16 11 * * *",
    timeZone: "Asia/Ho_Chi_Minh",
    secrets: [ZALO_BOT_TOKEN],
    region: "us-central1",
  },
  async () => {
    await runPutawayReminder(ZALO_BOT_TOKEN.value());
  }
);

/** 16:18 (Asia/Ho_Chi_Minh) hàng ngày */
exports.putawayReminderAt1618 = onSchedule(
  {
    schedule: "18 16 * * *",
    timeZone: "Asia/Ho_Chi_Minh",
    secrets: [ZALO_BOT_TOKEN],
    region: "us-central1",
  },
  async () => {
    await runPutawayReminder(ZALO_BOT_TOKEN.value());
  }
);

/**
 * Thứ 2–thứ 6, 11:30 (VN) — gửi Zalo cho ASP0106 (Work Order + Shipment, cùng logic tab Dashboard).
 * Chỉ secret ZALO_BOT_TOKEN; deploy: firebase deploy --only functions:zalo:notifyDashboardZaloWeekdays1130
 */
exports.notifyDashboardZaloWeekdays1130 = onSchedule(
  {
    schedule: "30 11 * * 1-5",
    timeZone: "Asia/Ho_Chi_Minh",
    secrets: [ZALO_BOT_TOKEN],
    region: "us-central1",
  },
  async () => {
    const token = ZALO_BOT_TOKEN.value();
    await runDashboardZaloDigest(db, token);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Outbound IQC Warning: khi scan outbound mà mã hàng đang ở vị trí IQC
// → ngay lập tức báo người scan + ASP0106
// ─────────────────────────────────────────────────────────────────────────────

exports.notifyOutboundIqcWarning = onDocumentCreated(
  {
    document: "outbound-iqc-warnings/{docId}",
    secrets: [ZALO_BOT_TOKEN],
    region: "us-central1",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};

    const materialCode = String(data.materialCode || "").trim();
    const location = String(data.location || "").trim();
    const employeeId = String(data.employeeId || "").trim();
    const factory = String(data.factory || "").trim();
    const productionOrder = String(data.productionOrder || "").trim();

    if (!materialCode || !employeeId) return;

    const botToken = ZALO_BOT_TOKEN.value();
    const now = new Date();
    const timeStr = now.toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour12: false,
    });

    const msg =
      `⚠️ CẢNH BÁO XUẤT KHO IQC\n\n` +
      `Mã hàng: ${materialCode}\n` +
      `Vị trí hiện tại: ${location}\n` +
      `Nhà máy: ${factory}\n` +
      (productionOrder ? `LSX: ${productionOrder}\n` : "") +
      `\nMã hàng đang ở vị trí IQC, vui lòng chuyển về vị trí kho trước khi xuất.\n` +
      `Thời gian: ${timeStr}`;

    // Gửi tới người scan
    const recipientIds = [employeeId, "ASP0106"].filter(
      (id, i, arr) => id && arr.indexOf(id) === i
    );

    const linkSnap = await db
      .collection("zalo_links")
      .where("memberId", "in", recipientIds.slice(0, 10))
      .get()
      .catch((e) => {
        logger.error("outbound-iqc: lookup zalo_links failed", e);
        return null;
      });

    if (!linkSnap || linkSnap.empty) {
      logger.warn("outbound-iqc: no chatId found", { recipientIds });
      return;
    }

    const chatIds = linkSnap.docs
      .map((d) => String((d.data() || {}).chatId || "").trim())
      .filter(Boolean);

    await Promise.all(
      chatIds.map((chatId) =>
        fetch(ZALO_BOT_SEND_MESSAGE_URL(botToken), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: msg }),
        }).catch((e) => logger.error("outbound-iqc: sendMessage failed", { chatId, e }))
      )
    );

    logger.info("outbound-iqc: sent warning", { materialCode, employeeId, factory });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Outbound IQC Daily Reminder: 8h sáng hàng ngày, kiểm tra mã hàng IQC chưa giải quyết
// → nhắc nhở từng nhân viên + gửi báo cáo cho ASP0106
// ─────────────────────────────────────────────────────────────────────────────

exports.outboundIqcDailyReminder = onSchedule(
  {
    schedule: "0 8 * * *",
    timeZone: "Asia/Ho_Chi_Minh",
    secrets: [ZALO_BOT_TOKEN],
    region: "us-central1",
  },
  async () => {
    const botToken = ZALO_BOT_TOKEN.value();

    // Lấy warnings chưa resolved trong 30 ngày gần nhất
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const warnSnap = await db
      .collection("outbound-iqc-warnings")
      .where("resolved", "==", false)
      .where("detectedAt", ">=", since)
      .get()
      .catch((e) => {
        logger.error("outbound-iqc-reminder: query failed", e);
        return null;
      });

    if (!warnSnap || warnSnap.empty) {
      logger.info("outbound-iqc-reminder: không có warning nào chưa resolved");
      return;
    }

    // Map: employeeId → list materialCode+location
    const employeeMap = new Map();
    const stillInIqc = [];

    for (const doc of warnSnap.docs) {
      const d = doc.data() || {};
      const materialCode = String(d.materialCode || "").trim();
      const factory = String(d.factory || "ASM1").trim();
      const poNumber = String(d.poNumber || "").trim();
      const employeeId = String(d.employeeId || "").trim();
      const location = String(d.location || "").trim();

      if (!materialCode) continue;

      // Kiểm tra xem mã hàng còn ở IQC không
      let stillIqc = false;
      try {
        const invSnap = await db
          .collection("inventory-materials")
          .where("factory", "==", factory)
          .where("materialCode", "==", materialCode)
          .where("poNumber", "==", poNumber)
          .limit(5)
          .get();

        if (!invSnap.empty) {
          stillIqc = invSnap.docs.some((d2) => {
            const loc = String((d2.data() || {}).location || "").trim().toUpperCase();
            return loc.startsWith("IQC");
          });
        }
      } catch (e) {
        logger.error("outbound-iqc-reminder: check inventory failed", { materialCode, e });
        stillIqc = true; // Giả sử vẫn còn nếu lỗi
      }

      if (stillIqc) {
        stillInIqc.push({ docId: doc.id, materialCode, factory, poNumber, employeeId, location });
        if (employeeId) {
          if (!employeeMap.has(employeeId)) employeeMap.set(employeeId, []);
          employeeMap.get(employeeId).push(`${materialCode} (${location})`);
        }
      } else {
        // Tự động resolve nếu không còn ở IQC
        await db.collection("outbound-iqc-warnings").doc(doc.id).update({ resolved: true }).catch(() => {});
      }
    }

    if (stillInIqc.length === 0) {
      logger.info("outbound-iqc-reminder: tất cả đã được giải quyết");
      return;
    }

    const now = new Date();
    const timeStr = now.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });

    // Gửi nhắc nhở tới từng nhân viên
    for (const [empId, materials] of employeeMap.entries()) {
      const linkSnap = await db
        .collection("zalo_links")
        .where("memberId", "==", empId)
        .limit(1)
        .get()
        .catch(() => null);

      if (!linkSnap || linkSnap.empty) continue;
      const chatId = String((linkSnap.docs[0].data() || {}).chatId || "").trim();
      if (!chatId) continue;

      const matList = materials.map((m) => `  • ${m}`).join("\n");
      const msg =
        `🔔 NHẮC NHỞ XUẤT KHO IQC\n\n` +
        `Các mã hàng sau vẫn đang ở vị trí IQC:\n${matList}\n\n` +
        `Vui lòng chuyển về vị trí kho sớm nhất có thể.\n` +
        `Thời gian: ${timeStr}`;

      await fetch(ZALO_BOT_SEND_MESSAGE_URL(botToken), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: msg }),
      }).catch((e) => logger.error("outbound-iqc-reminder: send to emp failed", { empId, e }));
    }

    // Gửi báo cáo tổng hợp tới ASP0106
    const asp0106Snap = await db
      .collection("zalo_links")
      .where("memberId", "==", "ASP0106")
      .limit(1)
      .get()
      .catch(() => null);

    if (asp0106Snap && !asp0106Snap.empty) {
      const asp0106ChatId = String((asp0106Snap.docs[0].data() || {}).chatId || "").trim();
      if (asp0106ChatId) {
        const reportLines = stillInIqc.map(
          (w) => `  • ${w.materialCode} | ${w.factory} | ${w.location} | NV: ${w.employeeId || "—"}`
        );
        const reportMsg =
          `📋 BÁO CÁO XUẤT KHO IQC (8h sáng)\n\n` +
          `Tổng: ${stillInIqc.length} mã hàng vẫn còn ở vị trí IQC:\n` +
          reportLines.join("\n") +
          `\n\nThời gian: ${timeStr}`;

        await fetch(ZALO_BOT_SEND_MESSAGE_URL(botToken), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: asp0106ChatId, text: reportMsg }),
        }).catch((e) => logger.error("outbound-iqc-reminder: send to ASP0106 failed", e));
      }
    }

    logger.info("outbound-iqc-reminder: done", { total: stillInIqc.length });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// QC NG: khi đổi trạng thái NG → nhắc nhóm kho cất vào vị trí NG (@ASP0119)
// Nhắc lại sau 2h nếu chưa cất — chỉ trong khung 8h–17h, T2–T7
// ─────────────────────────────────────────────────────────────────────────────

const ASM_KHO_DOC_BY_FACTORY = {
  ASM1: "kho_asm1",
  ASM2: "kho_asm2",
  ASM3: "kho_asm3",
};
const QC_NG_ASSIGNEE = "ASP0119";
const QC_NG_REMINDER_MS = 2 * 60 * 60 * 1000;

function isAtNgLocation(location) {
  const raw = String(location || "").replace(/\s/g, "").toUpperCase();
  return raw.startsWith("NG");
}

function isNgReminderBusinessHours(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const weekday = String(parts.weekday || "");
  const hour = Number(parts.hour);
  const allowedDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (!allowedDays.includes(weekday)) return false;
  return hour >= 8 && hour <= 17;
}

async function getKhoGroupChatId(factory) {
  const f = String(factory || "").trim().toUpperCase();
  const docId = ASM_KHO_DOC_BY_FACTORY[f];
  if (!docId) return null;
  try {
    const doc = await db.collection("zalo_group_config").doc(docId).get();
    if (!doc.exists) return null;
    return String((doc.data() || {}).chatId || "").trim() || null;
  } catch (e) {
    logger.warn("qc-ng: getKhoGroupChatId failed", {factory: f, e});
    return null;
  }
}

async function sendZaloTextMessage(botToken, chatId, text) {
  await fetch(ZALO_BOT_SEND_MESSAGE_URL(botToken), {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({chat_id: chatId, text}),
  });
}

const QUANLY_KHO_GROUP_CONFIG_DOC = "quanly_kho";

async function getQuanlyKhoGroupChatId() {
  try {
    const doc = await db.collection("zalo_group_config").doc(QUANLY_KHO_GROUP_CONFIG_DOC).get();
    if (!doc.exists) return null;
    return String((doc.data() || {}).chatId || "").trim() || null;
  } catch (e) {
    logger.warn("getQuanlyKhoGroupChatId failed", e);
    return null;
  }
}

function buildFgInCartonMismatchMessage(data) {
  const materialCode = String(data.materialCode || "").trim();
  const factory = String(data.factory || "").trim().toUpperCase();
  const poNumber = String(data.poNumber || "").trim();
  const lsx = String(data.lsx || "").trim();
  const lot = String(data.lot || "").trim();
  const quantity = data.quantity != null ? String(data.quantity) : "";
  const systemCarton = data.systemCarton != null ? String(data.systemCarton) : "";
  const reportedCarton = data.reportedCarton != null ? String(data.reportedCarton) : "";
  const employeeId = String(data.employeeId || "").trim();
  const timeStr = new Date().toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour12: false,
  });
  return [
    "⚠️ FG IN — SAI SỐ CARTON",
    "",
    `Mã TP: ${materialCode}`,
    `Nhà máy: ${factory || "—"}`,
    `PO: ${poNumber || "—"}`,
    `LSX: ${lsx || "—"}`,
    `LOT: ${lot || "—"}`,
    `Số lượng: ${quantity || "—"}`,
    `Carton hệ thống: ${systemCarton || "—"}`,
    `Carton thực tế: ${reportedCarton || "—"}`,
    employeeId ? `NV báo: ${employeeId}` : "",
    `Thời gian: ${timeStr}`,
  ].filter(Boolean).join("\n");
}

/** FG IN: báo nhóm Quản lý kho khi NV xác nhận sai số carton */
exports.notifyFgInCartonMismatch = onDocumentCreated(
  {
    document: "fg-in-carton-mismatch/{docId}",
    secrets: [ZALO_BOT_TOKEN],
    region: "us-central1",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};
    const materialCode = String(data.materialCode || "").trim();
    if (!materialCode) return;

    const botToken = ZALO_BOT_TOKEN.value();
    const chatId = await getQuanlyKhoGroupChatId();
    if (!chatId) {
      logger.warn("fg-in-carton: no quanly_kho group chatId");
      return;
    }

    const msg = buildFgInCartonMismatchMessage(data);
    try {
      await sendZaloTextMessage(botToken, chatId, msg);
      logger.info("fg-in-carton: sent to quanly_kho", {materialCode, docId: snap.id});
    } catch (e) {
      logger.error("fg-in-carton: sendMessage failed", {materialCode, e});
    }
  }
);

function buildQcNgStorageMessage(data) {
  const materialCode = String(data.materialCode || "").trim();
  const poNumber = String(data.poNumber || "").trim();
  const factory = String(data.factory || "").trim().toUpperCase();
  const location = String(data.location || "").trim();
  return [
    `⚠️ HÀNG NG CẦN ĐƯA VỀ VỊ TRÍ NG — ${factory}`,
    "",
    `• ${materialCode} | PO: ${poNumber || "—"} | Vị trí: ${location || "—"}`,
  ].join("\n");
}

async function checkMaterialStillNeedsNgStorage(data) {
  const materialId = String(data.materialId || "").trim();
  if (!materialId) {
    return {needsStorage: false, currentLocation: String(data.location || "").trim()};
  }
  try {
    const snap = await db.collection("inventory-materials").doc(materialId).get();
    if (!snap.exists) {
      return {needsStorage: false, currentLocation: ""};
    }
    const d = snap.data() || {};
    const status = String(d.iqcStatus || "").trim().toUpperCase();
    const loc = String(d.location || "").trim();
    if (status !== "NG") {
      return {needsStorage: false, currentLocation: loc};
    }
    if (isAtNgLocation(loc)) {
      return {needsStorage: false, currentLocation: loc};
    }
    return {needsStorage: true, currentLocation: loc};
  } catch (e) {
    logger.error("qc-ng: check inventory failed", {materialId, e});
    return {needsStorage: true, currentLocation: String(data.location || "").trim()};
  }
}

async function listNgNotAtNgLocation(factory) {
  const f = String(factory || "").trim().toUpperCase();
  try {
    const snap = await db
      .collection("inventory-materials")
      .where("factory", "==", f)
      .where("iqcStatus", "==", "NG")
      .get();
    const items = [];
    for (const doc of snap.docs) {
      const d = doc.data() || {};
      const loc = String(d.location || "").trim();
      if (isAtNgLocation(loc)) continue;
      items.push({
        materialId: doc.id,
        materialCode: String(d.materialCode || "").trim(),
        poNumber: String(d.poNumber || "").trim(),
        batchNumber: String(d.batchNumber || "").trim(),
        location: loc,
        factory: f,
        iqcNgError: String(d.iqcNgError || "").trim(),
      });
    }
    items.sort((a, b) => a.materialCode.localeCompare(b.materialCode));
    return items;
  } catch (e) {
    logger.error("qc-ng: listNgNotAtNgLocation failed", {factory: f, e});
    return [];
  }
}

function buildNgPendingKey(items) {
  return items.map((i) => i.materialId).sort().join("|");
}

function buildQcNgSummaryMessage(factory, items) {
  const f = String(factory || "").trim().toUpperCase();
  const lines = [`⚠️ HÀNG NG CẦN ĐƯA VỀ VỊ TRÍ NG — ${f}`, ""];
  const maxLines = 25;
  for (const it of items.slice(0, maxLines)) {
    lines.push(`• ${it.materialCode} | PO: ${it.poNumber || "—"} | Vị trí: ${it.location || "—"}`);
  }
  if (items.length > maxLines) {
    lines.push(`… và ${items.length - maxLines} mã khác`);
  }
  return lines.join("\n");
}

async function ensureRemindersForNgItems(items, factory) {
  for (const it of items) {
    const existing = await db
      .collection("qc-ng-storage-reminders")
      .where("materialId", "==", it.materialId)
      .where("resolved", "==", false)
      .limit(1)
      .get()
      .catch(() => null);
    if (!existing || !existing.empty) continue;
    await db.collection("qc-ng-storage-reminders").add({
      materialId: it.materialId,
      factory,
      materialCode: it.materialCode,
      poNumber: it.poNumber,
      batchNumber: it.batchNumber,
      imd: "",
      location: it.location,
      iqcNgError: it.iqcNgError,
      qcCheckedBy: "",
      assigneeId: QC_NG_ASSIGNEE,
      detectedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastNotifiedAt: null,
      resolved: false,
      source: "inventory_scan",
    });
  }
}

async function runQcNgKhoWarehouseAlerts(botToken) {
  for (const factory of ["ASM1", "ASM2", "ASM3"]) {
    const items = await listNgNotAtNgLocation(factory);
    const stateRef = db.collection("zalo_alert_state").doc(`qc_ng_kho_${factory}`);

    if (items.length === 0) {
      await stateRef.set(
        {
          pendingKey: "",
          pendingCount: 0,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        {merge: true}
      );
      continue;
    }

    await ensureRemindersForNgItems(items, factory);

    const pendingKey = buildNgPendingKey(items);
    const stateDoc = await stateRef.get();
    const state = stateDoc.exists ? stateDoc.data() || {} : {};
    const lastKey = String(state.pendingKey || "");
    const lastSummaryAt = state.lastSummaryAt?.toDate?.() || null;
    const nowMs = Date.now();
    const shouldSendSummary =
      pendingKey !== lastKey || !lastSummaryAt || nowMs - lastSummaryAt.getTime() >= QC_NG_REMINDER_MS;

    if (!shouldSendSummary) continue;

    const chatId = await getKhoGroupChatId(factory);
    if (!chatId) {
      logger.warn("qc-ng-summary: no kho group chatId", {factory});
      continue;
    }

    const msg = buildQcNgSummaryMessage(factory, items);
    try {
      await sendZaloTextMessage(botToken, chatId, msg);
      await stateRef.set(
        {
          pendingKey,
          pendingCount: items.length,
          lastSummaryAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        {merge: true}
      );

      const now = admin.firestore.FieldValue.serverTimestamp();
      for (const it of items) {
        const openSnap = await db
          .collection("qc-ng-storage-reminders")
          .where("materialId", "==", it.materialId)
          .where("resolved", "==", false)
          .limit(1)
          .get()
          .catch(() => null);
        if (openSnap && !openSnap.empty) {
          await openSnap.docs[0].ref.update({lastNotifiedAt: now, location: it.location}).catch(() => {});
        }
      }

      logger.info("qc-ng-summary: sent", {factory, count: items.length});
    } catch (e) {
      logger.error("qc-ng-summary: send failed", {factory, e});
    }
  }
}

async function notifyQcNgStorageToKhoGroup(botToken, data) {
  const factory = String(data.factory || "").trim().toUpperCase();
  const chatId = await getKhoGroupChatId(factory);
  if (!chatId) {
    logger.warn("qc-ng: no kho group chatId", {factory});
    return false;
  }
  const msg = buildQcNgStorageMessage(data);
  await sendZaloTextMessage(botToken, chatId, msg).catch((e) => {
    logger.error("qc-ng: sendMessage failed", {factory, chatId, e});
    throw e;
  });
  return true;
}

exports.notifyQcNgStorage = onDocumentCreated(
  {
    document: "qc-ng-storage-reminders/{docId}",
    secrets: [ZALO_BOT_TOKEN],
    region: "us-central1",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};
    if (data.resolved === true) return;
    if (data.source === "inventory_scan") {
      logger.info("qc-ng: skip instant notify for inventory_scan", {materialId: data.materialId});
      return;
    }

    const botToken = ZALO_BOT_TOKEN.value();
    const check = await checkMaterialStillNeedsNgStorage(data);
    if (!check.needsStorage) {
      await snap.ref.update({
        resolved: true,
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        resolvedReason: "already_at_ng_or_not_ng",
        location: check.currentLocation || data.location || "",
      }).catch(() => {});
      return;
    }

    const payload = {...data, location: check.currentLocation || data.location || ""};
    const sent = await notifyQcNgStorageToKhoGroup(botToken, payload);
    if (!sent) return;

    await snap.ref.update({
      lastNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      notificationCount: 1,
      location: payload.location,
    }).catch((e) => logger.error("qc-ng: update lastNotifiedAt failed", e));

    logger.info("qc-ng: sent initial notice", {
      materialCode: data.materialCode,
      factory: data.factory,
      materialId: data.materialId,
    });
  }
);

async function runQcNgStorageReminders(botToken) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const snap = await db
    .collection("qc-ng-storage-reminders")
    .where("resolved", "==", false)
    .where("detectedAt", ">=", since)
    .get()
    .catch((e) => {
      logger.error("qc-ng-reminder: query failed", e);
      return null;
    });

  if (!snap || snap.empty) {
    logger.info("qc-ng-reminder: no pending reminders");
    return;
  }

  const nowMs = Date.now();
  let reminded = 0;
  let resolved = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const check = await checkMaterialStillNeedsNgStorage(data);
    if (!check.needsStorage) {
      await doc.ref.update({
        resolved: true,
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        resolvedReason: "moved_to_ng_or_status_changed",
        location: check.currentLocation || data.location || "",
      }).catch(() => {});
      resolved++;
      continue;
    }

    const lastAt = data.lastNotifiedAt?.toDate?.() || data.detectedAt?.toDate?.() || null;
    if (!lastAt) continue;
    if (nowMs - lastAt.getTime() < QC_NG_REMINDER_MS) continue;

    const payload = {...data, location: check.currentLocation || data.location || ""};
    try {
      const sent = await notifyQcNgStorageToKhoGroup(botToken, payload);
      if (!sent) continue;
      await doc.ref.update({
        lastNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        notificationCount: Number(data.notificationCount || 0) + 1,
        location: payload.location,
      });
      reminded++;
    } catch (e) {
      logger.error("qc-ng-reminder: send failed", {docId: doc.id, e});
    }
  }

  logger.info("qc-ng-reminder: done", {reminded, resolved, total: snap.size});
}

/** Mỗi 15 phút, 8h–17h, T2–T7 — nhắc lại nếu quá 2h chưa cất NG */
exports.qcNgStorageReminder = onSchedule(
  {
    schedule: "*/15 8-17 * * 1-6",
    timeZone: "Asia/Ho_Chi_Minh",
    secrets: [ZALO_BOT_TOKEN],
    region: "us-central1",
  },
  async () => {
    const botToken = ZALO_BOT_TOKEN.value();
    if (!isNgReminderBusinessHours()) {
      logger.info("qc-ng-reminder: outside business hours, skip");
      return;
    }
    await runQcNgKhoWarehouseAlerts(botToken);
    await runQcNgStorageReminders(botToken);
  }
);
