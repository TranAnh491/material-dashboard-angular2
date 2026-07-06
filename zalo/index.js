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

    /** Trong nhóm: bỏ @tên_bot ở đầu tin nhắn. */
    const extractZaloCommandText = (raw) => {
      const t = String(raw || "").trim();
      if (!t || !t.startsWith("@")) return t;
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

    // Pending conversation state (onboarding)
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
      "- /link   (liên kết mã nhân viên để nhận thông báo)\n" +
      "- /id     (xem mã nhân viên đã liên kết)";

    // Greetings:
    // - Always show intro + guidance
    if (eventName === "message.text.received" && chatId && typeof text === "string" && isGreeting(text)) {
      try {
        await sendText(
          chatId,
          "Xin chào, em là trợ lý kho.\n" +
            "Gõ /link rồi nhập mã nhân viên (VD: ASP0106) để liên kết nhận thông báo qua Zalo.\n" +
            "Gõ /id để xem mã đã liên kết.\n\n" +
            "Gõ /chucnang để xem lại danh sách câu lệnh."
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
    if (eventName === "message.text.received" && chatId && typeof text === "string") {
      const t = text.trim().toUpperCase();
      if (isValidEmployeeCode(t)) {
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

    res.status(200).json({ok: true});
  }
);
