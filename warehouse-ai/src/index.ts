import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import OpenAI from "openai";

setGlobalOptions({ maxInstances: 10 });

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

export const chatAI = onCall({ secrets: [OPENAI_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Cần đăng nhập.");
  }

  const data: any = request.data || {};
  const message = typeof data.message === "string" ? data.message.trim() : "";
  const contextData = data.contextData ?? {};

  if (!message) {
    throw new HttpsError("invalid-argument", "Thiếu message.");
  }

  const client = new OpenAI({
    apiKey: OPENAI_API_KEY.value(),
  });

  let response: any;
  try {
    response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Bạn là trợ lý quản lý kho, trả lời ngắn gọn, dễ hiểu. Không bịa số liệu; nếu thiếu dữ liệu thì nói rõ.",
        },
        {
          role: "user",
          content:
            `Câu hỏi: ${message}\n` +
            `Dữ liệu kho (JSON): ${JSON.stringify(contextData).slice(0, 20000)}`,
        },
      ],
    });
  } catch (e: any) {
    const status = Number(e?.status || e?.response?.status || 0) || 0;
    const code = (e?.code || "").toString();
    if (status === 401 || code === "invalid_api_key") {
      throw new HttpsError(
        "failed-precondition",
        "OpenAI API key không đúng. Hãy set lại secret OPENAI_API_KEY và deploy lại functions."
      );
    }
    logger.error("OpenAI call failed", { status, code, message: e?.message });
    throw new HttpsError("internal", "Gọi OpenAI thất bại.");
  }

  const msg = response.choices?.[0]?.message;
  if (!msg) {
    logger.error("Empty OpenAI response", { responseId: (response as any)?.id });
    throw new HttpsError("internal", "OpenAI trả về rỗng.");
  }

  return msg;
});
