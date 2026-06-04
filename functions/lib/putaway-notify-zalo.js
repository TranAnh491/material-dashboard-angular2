"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPutawayNotifyZalo = sendPutawayNotifyZalo;
const params_config_1 = require("./params-config");
async function resolvechatIds(db, memberIds) {
    const results = [];
    for (const mid of memberIds) {
        const snap = await db
            .collection('zalo_links')
            .where('memberId', '==', mid)
            .limit(1)
            .get();
        if (!snap.empty) {
            const d = snap.docs[0].data();
            const chatId = String(d.chatId || '').trim();
            if (chatId)
                results.push({ memberId: mid, chatId });
        }
    }
    return results;
}
async function sendPutawayNotifyZalo(db, p) {
    var _a;
    const token = params_config_1.zaloBotToken.value().trim();
    if (!token)
        throw new Error('Thiếu ZALO_BOT_TOKEN');
    const links = await resolvechatIds(db, p.memberIds);
    const skipped = p.memberIds.filter(m => !links.find(l => l.memberId === m));
    if (!links.length) {
        throw new Error(`Không tìm thấy chatId cho các nhân viên: ${p.memberIds.join(', ')}`);
    }
    const now = new Date();
    const dateStr = now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
    const matList = p.materials.map(m => `  • ${m}`).join('\n');
    const msg = ((_a = p.message) === null || _a === void 0 ? void 0 : _a.trim()) ||
        `📦 [Cất NVL — ${String(p.factory || '').trim()}]\n` +
            `Thời gian: ${dateStr}\n` +
            `Các mã cần cất:\n${matList}\n` +
            `Vui lòng xác nhận và tiến hành cất kho.`;
    const url = `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/sendMessage`;
    const sent = [];
    await Promise.all(links.map(async ({ memberId, chatId }) => {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: msg })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            console.error(`[putaway-notify] Zalo sendMessage failed for ${memberId}: ${res.status}`, body);
        }
        else {
            sent.push(memberId);
        }
    }));
    return { sent, skipped };
}
//# sourceMappingURL=putaway-notify-zalo.js.map