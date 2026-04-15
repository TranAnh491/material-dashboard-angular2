/**
 * Tóm tắt Work Order + Shipment giống tab Dashboard (dashboard.component.ts).
 * Gửi Zalo Bot cho ASP0106 — chỉ cần bot token (không dùng SMTP).
 */
const admin = require("firebase-admin");

const WORK_ORDER_STATUS_DONE = "done";
const TARGET_MEMBER_ID = "ASP0106";

function normFactory(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseDeliveryDate(data) {
  const v = data.deliveryDate;
  if (v == null) return null;
  if (v instanceof admin.firestore.Timestamp) return v.toDate();
  if (typeof v === "object" && v !== null && typeof v.toDate === "function") {
    return v.toDate();
  }
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isWorkOrderInCurrentMonth(data, deliveryDate, now) {
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1;
  const y = Number(data.year);
  const m = Number(data.month);
  if (Number.isFinite(y) && Number.isFinite(m) && y > 0 && m >= 1 && m <= 12) {
    return y === cy && m === cm;
  }
  if (!deliveryDate) return false;
  return deliveryDate.getFullYear() === cy && deliveryDate.getMonth() + 1 === cm;
}

function filterWorkOrdersByFactory(rows, factoryFilter) {
  const targets = factoryFilter.map(normFactory);
  return rows.filter(({data}) => {
    const woFactory = String(data.factory || "ASM1");
    return targets.includes(normFactory(woFactory));
  });
}

function computeWorkOrderSummary(docs, factoryFilter, now) {
  const rows = docs.map((doc) => {
    const data = doc.data() || {};
    return {data, deliveryDate: parseDeliveryDate(data)};
  });
  const filtered = filterWorkOrdersByFactory(rows, factoryFilter);
  const monthOrders = filtered.filter(({data, deliveryDate}) =>
    isWorkOrderInCurrentMonth(data, deliveryDate, now)
  );

  if (monthOrders.length === 0) return "0/0";

  const total = monthOrders.length;
  const completed = monthOrders.filter(({data}) => {
    if (data.isCompleted === true) return true;
    if (String(data.status || "").toLowerCase() === WORK_ORDER_STATUS_DONE) return true;
    return false;
  }).length;

  return `${completed}/${total}`;
}

function getShipmentMonthReferenceDate(s) {
  if (s.actualShipDate) {
    const v = s.actualShipDate;
    const d = v && typeof v.toDate === "function" ? v.toDate() : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (s.requestDate) {
    const v = s.requestDate;
    const d = v && typeof v.toDate === "function" ? v.toDate() : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isShipmentInCurrentMonth(s, now) {
  const d = getShipmentMonthReferenceDate(s);
  if (!d) return false;
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function computeShipmentSummary(docs, now) {
  const all = docs.map((d) => d.data() || {});
  const monthShipments = all.filter((s) => isShipmentInCurrentMonth(s, now));

  const shipmentGroups = new Map();
  for (const s of monthShipments) {
    const code = String(s.shipmentCode || "")
      .trim()
      .toUpperCase();
    if (!code) continue;
    if (!shipmentGroups.has(code)) shipmentGroups.set(code, []);
    shipmentGroups.get(code).push(s);
  }

  const totalShipments = shipmentGroups.size;
  let completedShipments = 0;
  shipmentGroups.forEach((items) => {
    const allShipped = items.every((item) => String(item.status || "") === "Đã Ship");
    if (allShipped) completedShipments++;
  });

  if (totalShipments === 0) return "0/0";
  return `${completedShipments}/${totalShipments}`;
}

function buildMessage(asm1Wo, asm2Wo, shipment, now) {
  const label = now.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return (
    `📊 Dashboard — ${label}\n\n` +
    `ASM1 — Work Order (Done/Tổng tháng): ${asm1Wo}\n` +
    `ASM2 — Work Order (Done/Tổng tháng): ${asm2Wo}\n\n` +
    `Shipment (Đã ship/Tổng tháng — giống tab Dashboard): ${shipment}`
  );
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} botToken
 */
async function runDashboardZaloDigest(db, botToken) {
  const now = new Date();
  const [woSnap, shipSnap, linkSnap] = await Promise.all([
    db.collection("work-orders").get(),
    db.collection("shipments").get(),
    db.collection("zalo_links").where("memberId", "==", TARGET_MEMBER_ID).limit(1).get(),
  ]);

  if (linkSnap.empty) {
    console.warn("dashboard-digest: no zalo_links for", TARGET_MEMBER_ID);
    return;
  }

  const chatId = String(linkSnap.docs[0].data()?.chatId || "").trim();
  if (!chatId) {
    console.warn("dashboard-digest: missing chatId");
    return;
  }

  const asm1Wo = computeWorkOrderSummary(woSnap.docs, ["ASM1", "Sample 1"], now);
  const asm2Wo = computeWorkOrderSummary(woSnap.docs, ["ASM2", "Sample 2"], now);
  const shipment = computeShipmentSummary(shipSnap.docs, now);
  const text = buildMessage(asm1Wo, asm2Wo, shipment, now);

  const token = String(botToken || "").trim();
  if (!token) {
    console.error("dashboard-digest: missing bot token");
    return;
  }

  const url = `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({chat_id: chatId, text}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("dashboard-digest: sendMessage failed", res.status, body);
    return;
  }
  console.log("dashboard-digest: sent", {ok: body?.ok});
}

module.exports = {runDashboardZaloDigest};
