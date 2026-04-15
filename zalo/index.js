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
    const text = message?.text;

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
      const t = normalize(s).toLowerCase();
      return (
        t === "hi" ||
        t === "hello" ||
        t === "helo" ||
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

    const startOnboarding = async () => {
      await db
        .collection("zalo_pending")
        .doc(chatId)
        .set(
          {intent: "onboarding", step: "employeeCode", updatedAt: admin.firestore.FieldValue.serverTimestamp()},
          {merge: true}
        );
      await sendText(chatId, "Chào bạn. Vui lòng nhập **Mã nhân viên** (ví dụ: ASP0106).");
    };

    // Pending conversation state for /tonkho natural flow
    // Stored per chatId: { intent: "tonkho", materialCode: "B001680" }
    if (eventName === "message.text.received" && chatId && typeof text === "string") {
      try {
        const pendingRef = db.collection("zalo_pending").doc(chatId);
        const pendingSnap = await pendingRef.get();
        const pending = pendingSnap.exists ? pendingSnap.data() : null;

        // Onboarding flow: greeting -> ask employee code -> ask name -> save
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
              {
                intent: "onboarding",
                step: "name",
                memberId: code,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              {merge: true}
            );
            await sendText(chatId, `OK. Bạn nhập **Tên** của bạn để hoàn tất (ví dụ: Tuấn Anh).`);
            res.status(200).json({ok: true});
            return;
          }

          if (pending.step === "name") {
            const name = t;
            const memberId = String(pending.memberId || "").toUpperCase();
            if (!memberId || !isValidEmployeeCode(memberId)) {
              // fallback: restart
              await pendingRef.delete().catch(() => {});
              await startOnboarding();
              res.status(200).json({ok: true});
              return;
            }
            if (!name) {
              await sendText(chatId, "Tên không được để trống. Vui lòng nhập lại tên của bạn.");
              res.status(200).json({ok: true});
              return;
            }

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
              `Đã liên kết thành công.\nMã: ${memberId}\nTên: ${name}\n\n${name} muốn làm gì?\n- Gõ: tồn kho <MA_HANG>\n- Hoặc: /tonkho ASM1 <MA_HANG>\n- Hoặc: /tonkho ASM2 <MA_HANG>`
            );
            res.status(200).json({ok: true});
            return;
          }
        }

        // If user previously asked "tồn kho <code>" then we wait for ASM1/ASM2
        if (pending?.intent === "tonkho" && pending?.materialCode) {
          const answer = text.trim().toUpperCase();
          if (["ASM1", "ASM2"].includes(answer)) {
            const factory = answer;
            const code = String(pending.materialCode).trim().toUpperCase();

            // Clear pending first to avoid loops
            await pendingRef.delete().catch(() => {});

            try {
              const snap = await db
                .collection("inventory-materials")
                .where("factory", "==", factory)
                .where("materialCode", "==", code)
                .limit(20)
                .get();

              if (snap.empty) {
                await fetch(ZALO_BOT_SEND_MESSAGE_URL(botToken), {
                  method: "POST",
                  headers: {"Content-Type": "application/json"},
                  body: JSON.stringify({
                    chat_id: chatId,
                    text: `Không tìm thấy tồn cho ${code} (${factory}).`,
                  }),
                });
                res.status(200).json({ok: true});
                return;
              }

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

              const reply = `Tồn kho ${factory}\nMã: ${code}\nTổng: ${total}\n` + (lines.length ? `Chi tiết:\n${lines.join("\n")}` : "");
              await fetch(ZALO_BOT_SEND_MESSAGE_URL(botToken), {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({chat_id: chatId, text: reply}),
              });
              res.status(200).json({ok: true});
              return;
            } catch (err) {
              logger.error("tonkho pending flow failed", err);
              await fetch(ZALO_BOT_SEND_MESSAGE_URL(botToken), {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({chat_id: chatId, text: "Lỗi khi kiểm tra tồn kho."}),
              });
              res.status(200).json({ok: true});
              return;
            }
          }
        }
      } catch (err) {
        logger.error("pending state read failed", err);
      }
    }

    // Greetings:
    // - If linked: greet by name and show menu
    // - If not linked: start onboarding
    if (eventName === "message.text.received" && chatId && typeof text === "string" && isGreeting(text)) {
      try {
        const profile = await getLinkedProfile(chatId);
        if (profile?.name) {
          await sendText(
            chatId,
            `Chào ${profile.name}. Bạn muốn làm gì?\n- Gõ: tồn kho <MA_HANG>\n- Hoặc: /tonkho ASM1 <MA_HANG>\n- Hoặc: /tonkho ASM2 <MA_HANG>`
          );
        } else {
          await startOnboarding();
        }
      } catch (err) {
        logger.error("greeting handler failed", err);
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
          await sendText(chatId, "Bạn chưa liên kết. Vui lòng nhắn 'hi' để bắt đầu nhập mã nhân viên và tên.");
        }
      } catch (err) {
        logger.error("id command failed", err);
      }
      res.status(200).json({ok: true});
      return;
    }

    // Command: /scarp (alias /scrap) with password gate (password = 2026)
    // Flow:
    // - User: /scarp  -> bot asks password
    // - User: 2026    -> bot asks material code
    // - User: B001680 -> bot checks scrap store and replies
    const SCRAP_PASSWORD = "2026";
    const SCRAP_AUTH_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

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

        if (snap.empty) {
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

        await sendText(
          chatId,
          `Kho scrap: CÓ mã ${code7}.\nTổng (ước tính): ${totalBags} bag.\nThùng:\n${boxes || "—"}`
        );
      } catch (err) {
        logger.error("scrap lookup failed", err);
        await sendText(chatId, "Lỗi khi tra cứu kho scrap.");
      }
    };

    if (eventName === "message.text.received" && chatId && typeof text === "string") {
      const t = text.trim();
      const pendingRef = db.collection("zalo_pending").doc(chatId);
      const pendingSnap = await pendingRef.get().catch(() => null);
      const pending = pendingSnap?.exists ? pendingSnap.data() : null;

      const authedUntilMs = pending?.scrapAuthedUntilMs ? Number(pending.scrapAuthedUntilMs) : 0;
      const isAuthed = Number.isFinite(authedUntilMs) && authedUntilMs > Date.now();

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

    // Command: /tonkho <ASM1|ASM2> <MA_HANG>
    // Data source matches Angular tabs: collection `inventory-materials` with fields:
    // - factory: "ASM1" | "ASM2"
    // - materialCode: string
    // - quantity: number (fallbacks supported below)
    if (eventName === "message.text.received" && chatId && typeof text === "string") {
      const t = text.trim();
      // Natural text: "tồn kho B001680" (accepts without accents too)
      const m = t.match(/^(?:t[oòóỏõọôồốổỗộơờớởỡợ]n\\s+kho|ton\\s+kho)\\s+([A-Za-z0-9._-]+)\\s*$/i);
      if (m?.[1]) {
        const code = m[1].trim().toUpperCase();
        try {
          await db.collection("zalo_pending").doc(chatId).set(
            {
              intent: "tonkho",
              materialCode: code,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            {merge: true}
          );
        } catch (err) {
          logger.error("set pending tonkho failed", err);
        }

        await sendText(chatId, `Bạn muốn xem tồn kho ở nhà máy nào cho mã ${code}?\nTrả lời: ASM1 hoặc ASM2`);

        res.status(200).json({ok: true});
        return;
      }

      if (t.toLowerCase().startsWith("/tonkho")) {
        const parts = t.split(/\s+/g).filter(Boolean);
        const factory = (parts[1] || "").toUpperCase();
        const materialCode = (parts[2] || "").trim();

        if (!factory || !materialCode || !["ASM1", "ASM2"].includes(factory)) {
          await sendText(chatId, "Cú pháp:\n/tonkho ASM1 <MA_HANG>\nhoặc\n/tonkho ASM2 <MA_HANG>");
          res.status(200).json({ok: true});
          return;
        }

        try {
          const code = materialCode.toUpperCase();
          const snap = await db
            .collection("inventory-materials")
            .where("factory", "==", factory)
            .where("materialCode", "==", code)
            .limit(20)
            .get();

          if (snap.empty) {
            await sendText(chatId, `Không tìm thấy tồn cho ${code} (${factory}).`);
            res.status(200).json({ok: true});
            return;
          }

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

          const reply =
            `Tồn kho ${factory}\nMã: ${materialCode.toUpperCase()}\nTổng: ${total}\n` +
            (lines.length ? `Chi tiết:\n${lines.join("\n")}` : "");

          await sendText(chatId, reply);
        } catch (err) {
          logger.error("tonkho failed", err);
          await sendText(chatId, "Lỗi khi kiểm tra tồn kho.");
        }

        res.status(200).json({ok: true});
        return;
      }
    }

    // Link account flow:
    // Employee sends 2 lines:
    // Line 1: Employee code (ASP + 4 digits), e.g. "ASP0106" (case-insensitive)
    // Line 2: Name, e.g. "Tuấn Anh"
    //
    // We store: memberId = employee code, name, chatId
    if (eventName === "message.text.received" && chatId && typeof text === "string") {
      const lines = text
        .split(/\r?\n/g)
        .map((l) => l.trim())
        .filter(Boolean);

      if (lines.length >= 2) {
        const memberId = String(lines[0]).toUpperCase();
        const name = lines[1];

        if (isValidEmployeeCode && name) {
          try {
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

            await sendText(chatId, `Đã liên kết thành công.\nMã: ${memberId}\nTên: ${name}\nchat_id: ${chatId}`);
          } catch (err) {
            logger.error("Link account failed", err);
          }
        }
      }
    }

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
