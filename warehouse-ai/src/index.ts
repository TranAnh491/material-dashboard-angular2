import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { GoogleGenerativeAI } from "@google/generative-ai";

setGlobalOptions({ maxInstances: 10 });

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

export const chatAI = onCall({ secrets: [GEMINI_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Cần đăng nhập.");
  }

  const data: any = request.data || {};
  const message = typeof data.message === "string" ? data.message.trim() : "";
  const contextData = data.contextData ?? {};

  if (!message) {
    throw new HttpsError("invalid-argument", "Thiếu message.");
  }

  const rawKey = (GEMINI_API_KEY.value() || "").toString();
  const apiKey = rawKey.trim();
  logger.info("chatAI (Gemini) key check", {
    keyPrefix: apiKey.slice(0, 6),
    keyLen: apiKey.length,
    hasLeadingOrTrailingWhitespace: rawKey.length !== apiKey.length,
    uid: request.auth.uid,
  });

  if (!apiKey) {
    throw new HttpsError(
      "failed-precondition",
      "Chưa cấu hình GEMINI_API_KEY trên Functions. Hãy set secret GEMINI_API_KEY rồi deploy lại functions."
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt =
    "Bạn là trợ lý quản lý kho, trả lời ngắn gọn, dễ hiểu. Không bịa số liệu; nếu thiếu dữ liệu thì nói rõ.\n\n" +
    `Câu hỏi: ${message}\n\n` +
    `Dữ liệu kho (JSON): ${JSON.stringify(contextData).slice(0, 20000)}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response?.text?.() ? result.response.text().trim() : "";
    if (!text) {
      logger.error("Empty Gemini response", { uid: request.auth.uid });
      throw new HttpsError("internal", "Gemini trả về rỗng.");
    }
    return { content: text };
  } catch (e: any) {
    const message = (e?.message || "").toString();
    logger.error("Gemini call failed", { message, uid: request.auth.uid });
    throw new HttpsError("internal", "Gọi Gemini thất bại.");
  }
});
