"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAILY_ASSIGNEE_COUNT = exports.SLOTS_PER_DAY = void 0;
exports.getVnDateTime = getVnDateTime;
exports.slotFromHour = slotFromHour;
exports.getReminderAction = getReminderAction;
exports.pickDailyAssignees = pickDailyAssignees;
exports.isFactorySlotComplete = isFactorySlotComplete;
exports.runNhietDoZaloRemind = runNhietDoZaloRemind;
const admin = __importStar(require("firebase-admin"));
const params_config_1 = require("./params-config");
const FACTORIES = ['ASM1', 'ASM2'];
const FORM_TYPES = ['regular', 'special', 'cold'];
const ESCALATION_MEMBER_IDS = ['ASP0119', 'ASP1761', 'ASP0538'];
/** 3 biểu mẫu × 2 ca/ngày */
exports.SLOTS_PER_DAY = 6;
/** Số ID nhận nhắc mỗi ngày */
exports.DAILY_ASSIGNEE_COUNT = 2;
const SETTINGS_COLLECTION = 'nhiet-do-zalo-settings';
const STATE_COLLECTION = 'nhiet-do-reminder-state';
const CHECKLIST_COLLECTION = 'warehouse-temp-humidity-checklists';
const FORM_LABELS = {
    regular: 'Kho Thường',
    special: 'Kho Lưu Trữ Đặc Biệt',
    cold: 'Tủ Lạnh'
};
function getVnDateTime(now = new Date()) {
    var _a;
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hour12: false
    }).formatToParts(now);
    const get = (t) => { var _a, _b; return (_b = (_a = parts.find(p => p.type === t)) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : ''; };
    const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
        year: Number(get('year')),
        month: Number(get('month')),
        day: Number(get('day')),
        hour: Number(get('hour')),
        minute: Number(get('minute')),
        weekday: (_a = wdMap[get('weekday')]) !== null && _a !== void 0 ? _a : 0
    };
}
function slotFromHour(hour) {
    if (hour >= 8 && hour <= 10)
        return 'morning';
    if (hour >= 14 && hour <= 16)
        return 'afternoon';
    return null;
}
/** 8:55 / 9:25 / 9:55 và 14:55 / 15:25 / 15:55 (VN) */
function getReminderAction(hour, minute, slot) {
    const t = hour * 60 + minute;
    if (slot === 'morning') {
        if (t >= 8 * 60 + 53 && t <= 8 * 60 + 59)
            return 1;
        if (t >= 9 * 60 + 23 && t <= 9 * 60 + 29)
            return 2;
        if (t >= 9 * 60 + 53 && t <= 9 * 60 + 59)
            return 'escalate';
    }
    else {
        if (t >= 14 * 60 + 53 && t <= 14 * 60 + 59)
            return 1;
        if (t >= 15 * 60 + 23 && t <= 15 * 60 + 29)
            return 2;
        if (t >= 15 * 60 + 53 && t <= 15 * 60 + 59)
            return 'escalate';
    }
    return null;
}
function seededRandom(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return () => {
        h += 0x6d2b79f5;
        let t = Math.imul(h ^ (h >>> 15), 1 | h);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** Chọn ngẫu nhiên (ổn định theo ngày) 2 ID từ danh sách nhà máy */
function pickDailyAssignees(memberIds, factory, dateKey, count = exports.DAILY_ASSIGNEE_COUNT) {
    const ids = [...new Set(memberIds.map(normalizeMemberId).filter(Boolean))];
    if (!ids.length)
        return [];
    if (ids.length <= count)
        return ids;
    const rng = seededRandom(`${factory}:${dateKey}`);
    const arr = [...ids];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, count);
}
function normalizeMemberId(raw) {
    const t = String(raw || '').trim().toUpperCase();
    if (!t)
        return '';
    const id = t.substring(0, 7);
    if (id.length === 7 && id.startsWith('ASP') && /^\d{4}$/.test(id.substring(3)))
        return id;
    return t;
}
async function resolveChatIds(db, memberIds) {
    const uniq = [...new Set(memberIds.map(normalizeMemberId).filter(Boolean))];
    if (!uniq.length)
        return [];
    const snap = await db.collection('zalo_links').get();
    const byMember = new Map();
    snap.docs.forEach(doc => {
        const d = doc.data();
        const mid = normalizeMemberId(d.memberId || '');
        const chatId = String(d.chatId || doc.id || '').trim();
        if (mid && chatId && !byMember.has(mid))
            byMember.set(mid, chatId);
    });
    return uniq
        .filter(mid => byMember.has(mid))
        .map(mid => ({ memberId: mid, chatId: byMember.get(mid) }));
}
async function sendZaloText(token, chatIds, text) {
    const url = `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/sendMessage`;
    await Promise.all(chatIds.map(async (chatId) => {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text })
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.error('[nhiet-do-zalo] send failed', res.status, body);
        }
    }));
}
function isFiniteNum(v) {
    return v != null && Number.isFinite(Number(v));
}
function isDayReadingComplete(day, slot) {
    if (slot === 'morning') {
        return isFiniteNum(day.tempMorning) && isFiniteNum(day.humidityMorning);
    }
    return isFiniteNum(day.tempAfternoon) && isFiniteNum(day.humidityAfternoon);
}
async function isFactorySlotComplete(db, factory, vn, slot) {
    var _a;
    const monthPad = String(vn.month).padStart(2, '0');
    const dayIdx = vn.day - 1;
    const daysInMonth = new Date(vn.year, vn.month, 0).getDate();
    if (vn.day < 1 || vn.day > daysInMonth) {
        return { complete: true, missing: [] };
    }
    const missing = [];
    for (const formType of FORM_TYPES) {
        const docId = `${factory}-${formType}-${vn.year}-${monthPad}`;
        const snap = await db.collection(CHECKLIST_COLLECTION).doc(docId).get();
        const days = ((_a = snap.data()) === null || _a === void 0 ? void 0 : _a.days) || [];
        const row = days[dayIdx] || {};
        if (!isDayReadingComplete(row, slot)) {
            missing.push(FORM_LABELS[formType] || formType);
        }
    }
    return { complete: missing.length === 0, missing };
}
function stateDocId(factory, dateKey, slot) {
    return `${factory}_${dateKey}_${slot}`;
}
function buildMessage(factory, slot, action, missing, vn, assigneeIds) {
    const slotVi = slot === 'morning' ? 'Sáng (9:00)' : 'Chiều (15:00)';
    const slotEn = slot === 'morning' ? 'Morning' : 'Afternoon';
    const dateStr = `${String(vn.day).padStart(2, '0')}/${String(vn.month).padStart(2, '0')}/${vn.year}`;
    const missLines = missing.map(m => `  • ${m}`).join('\n');
    const dutyLine = (assigneeIds === null || assigneeIds === void 0 ? void 0 : assigneeIds.length)
        ? `Phụ trách hôm nay: ${assigneeIds.join(', ')}\n`
        : '';
    if (action === 'escalate') {
        return (`🚨 [Nhiệt độ & Độ ẩm — ${factory}] Chưa cập nhật sau 2 lần nhắc\n` +
            `Ca: ${slotVi} · Ngày ${dateStr}\n` +
            dutyLine +
            `Thiếu biểu mẫu:\n${missLines}\n` +
            `Vui lòng xử lý gấp. / Urgent update required.`);
    }
    const remindNo = action === 1 ? '1' : '2';
    return (`🌡️ [Nhiệt độ & Độ ẩm — ${factory}] Nhắc cập nhật (lần ${remindNo})\n` +
        `Ca: ${slotVi} (${slotEn}) · Ngày ${dateStr}\n` +
        dutyLine +
        `(3 biểu mẫu × 2 ca = ${exports.SLOTS_PER_DAY} lần ghi/ngày)\n` +
        `Vui lòng nhập số liệu các biểu mẫu:\n${missLines}\n` +
        `Tab: Nhiệt Độ → ${factory}`);
}
async function loadFactorySettings(db, factory) {
    const snap = await db.collection(SETTINGS_COLLECTION).doc(factory).get();
    return snap.data() || { memberIds: [], enabled: true };
}
async function runNhietDoZaloRemind(db) {
    var _a, _b, _c;
    const token = params_config_1.zaloBotToken.value().trim();
    if (!token) {
        console.error('[nhiet-do-zalo] missing ZALO_BOT_TOKEN');
        return;
    }
    const vn = getVnDateTime();
    if (vn.weekday === 0) {
        console.log('[nhiet-do-zalo] Sunday — skip');
        return;
    }
    const slot = slotFromHour(vn.hour);
    if (!slot)
        return;
    const action = getReminderAction(vn.hour, vn.minute, slot);
    if (!action)
        return;
    const dateKey = `${vn.year}-${String(vn.month).padStart(2, '0')}-${String(vn.day).padStart(2, '0')}`;
    for (const factory of FACTORIES) {
        try {
            const settings = await loadFactorySettings(db, factory);
            if (settings.enabled === false)
                continue;
            const { complete, missing } = await isFactorySlotComplete(db, factory, vn, slot);
            const stateRef = db.collection(STATE_COLLECTION).doc(stateDocId(factory, dateKey, slot));
            const stateSnap = await stateRef.get();
            const stage = Number((_b = (_a = stateSnap.data()) === null || _a === void 0 ? void 0 : _a.stage) !== null && _b !== void 0 ? _b : 0);
            if (complete) {
                if (!((_c = stateSnap.data()) === null || _c === void 0 ? void 0 : _c.completed)) {
                    await stateRef.set({ factory, dateKey, slot, completed: true, stage, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
                }
                continue;
            }
            const expectedStage = action === 1 ? 0 : action === 2 ? 1 : 2;
            if (stage !== expectedStage)
                continue;
            const pool = (settings.memberIds || []).map(normalizeMemberId).filter(Boolean);
            const dailyAssignees = pickDailyAssignees(pool, factory, dateKey);
            const memberIds = action === 'escalate'
                ? [...new Set([...dailyAssignees, ...ESCALATION_MEMBER_IDS])]
                : dailyAssignees;
            const links = await resolveChatIds(db, memberIds);
            if (!links.length) {
                console.warn(`[nhiet-do-zalo] ${factory} ${slot} no chatId for`, memberIds);
                continue;
            }
            const msg = buildMessage(factory, slot, action, missing, vn, dailyAssignees);
            await sendZaloText(token, links.map(l => l.chatId), msg);
            const newStage = action === 'escalate' ? 3 : action === 2 ? 2 : 1;
            await stateRef.set({
                factory,
                dateKey,
                slot,
                stage: newStage,
                lastAction: String(action),
                completed: false,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            console.log(`[nhiet-do-zalo] sent ${factory} ${slot} action=${action} stage→${newStage}`);
        }
        catch (e) {
            console.error(`[nhiet-do-zalo] ${factory} error`, e);
        }
    }
}
//# sourceMappingURL=nhiet-do-zalo-remind.js.map