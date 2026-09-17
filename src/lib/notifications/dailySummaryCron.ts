import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import { formatCurrency } from "@/lib/format";
import { addDaysToKey, bangkokDateKey, bangkokDayBounds } from "@/lib/pos/dateRange";
import { summarizeOrders, topProducts } from "@/lib/pos/reports";
import type { NotificationSettings, Order } from "@/types";

import { notifyShop } from "./notifyShop";

/**
 * Runs once a day at 04:00 Bangkok time (see `vercel.json`'s cron entry and
 * `/api/cron/daily-summary`), sweeping every shop that has Telegram notifications on and
 * reporting *yesterday's* (Bangkok calendar day) sales — reusing the exact same pure
 * `summarizeOrders`/`topProducts` functions the `/admin/reports` page charts already use, just
 * fed from an Admin SDK query instead of the client SDK `orderRepository` (this runs with no
 * signed-in user, so the client SDK + Security Rules path isn't available here — same reasoning
 * as every other cron/Admin-SDK-only route in this codebase).
 */
export async function runDailySummaryCron(db: Firestore): Promise<{ sent: number; skipped: number }> {
  const yesterdayKey = addDaysToKey(bangkokDateKey(Date.now()), -1);
  const { startMs, endMs } = bangkokDayBounds(yesterdayKey);

  const settingsSnap = await db
    .collection(COLLECTIONS.notificationSettings)
    .where("enabled", "==", true)
    .get();

  let sent = 0;
  let skipped = 0;

  for (const doc of settingsSnap.docs) {
    const settings = doc.data() as Omit<NotificationSettings, "id">;
    if (!settings.telegramBotToken || !settings.telegramChatId || settings.notifyDailySummary === false) {
      skipped++;
      continue;
    }
    const shopId = doc.id;

    const ordersSnap = await db
      .collection(COLLECTIONS.orders)
      .where("shopId", "==", shopId)
      .where("status", "==", "PAID")
      .where("paidAt", ">=", startMs)
      .where("paidAt", "<=", endMs)
      .get();
    const orders = ordersSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as Order);

    const summary = summarizeOrders(orders);
    // 10 — shop owner asked for "สินค้าขายดีสัก 10 รายการ" (was 5).
    const best = topProducts(orders, 10);

    const bestLines = best.length
      ? best.map((p, i) => `${i + 1}. ${p.productName} — ${p.qty} ชิ้น`).join("\n")
      : "ไม่มีรายการขาย";

    const text =
      `📊 สรุปยอดวันที่ ${yesterdayKey}\n\n` +
      `ยอดขายรวม: ${formatCurrency(summary.revenue, "THB")}\n` +
      `จำนวนบิล: ${summary.orderCount} บิล\n` +
      `ยอดเฉลี่ยต่อบิล: ${formatCurrency(summary.avgOrderValue, "THB")}\n\n` +
      `🏆 สินค้าขายดี\n${bestLines}`;

    await notifyShop(db, shopId, text, "dailySummary");
    sent++;
  }

  return { sent, skipped };
}
