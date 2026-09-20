import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import { formatCurrency } from "@/lib/format";
import { bangkokDateKeyWithCutoff, bangkokHour } from "@/lib/pos/dateRange";
import { summarizeOrders, topProducts } from "@/lib/pos/reports";
import { businessDayBounds, businessDaySales } from "@/lib/pos/reconciliation";
import type { NotificationSettings, Order, PaymentMethod } from "@/types";

import { notifyShop } from "./notifyShop";

const DEFAULT_DAILY_SUMMARY_HOUR = 4;

// Matches `/admin/accounting`'s and `/admin/reports`' own default `fromHour` — a shift starting
// 16:00 is labeled by that same calendar date (see `bangkokDateKeyWithCutoff`'s comment). Not yet
// a per-shop setting (`NotificationSettings` has no `fromHour` field), so this is hardcoded to
// the one value every shop in this codebase actually uses.
const BUSINESS_DAY_FROM_HOUR = 16;

/**
 * Runs every hour (see `vercel.json`'s cron entry and `/api/cron/daily-summary`) rather than
 * once at a fixed time — each shop now picks its own send hour
 * (`NotificationSettings.dailySummaryHour`, "สามารถเลือกเวลาสรุปบิลรายวันได้"), so this sweeps
 * every shop every hour and only actually sends to the ones whose chosen hour matches *now*,
 * skipping the rest. `lastDailySummaryDateKey` guards against sending the same day's summary
 * twice if the cron ever fires more than once within that hour (a Vercel retry, a manual curl).
 * Reports on the *business day that most recently closed* (16:00-cutoff shift, not a plain
 * midnight-to-midnight calendar day — item: "ทำไมสรุปมาไม่เท่ากัน", the LINE/Telegram summary used
 * to disagree with `/admin/reports`' business-day-toggle numbers over exactly this), reusing the
 * exact same pure `summarizeOrders`/`topProducts`/`businessDaySales` functions the admin pages
 * already use, just fed from an Admin SDK query instead of the client SDK `orderRepository`
 * (this runs with no signed-in user, so the client SDK + Security Rules path isn't available
 * here — same reasoning as every other cron/Admin-SDK-only route in this codebase).
 */
export async function runDailySummaryCron(db: Firestore): Promise<{ sent: number; skipped: number }> {
  const now = Date.now();
  const currentHour = bangkokHour(now);
  // At any hour before 16:00 (which covers every reasonable `dailySummaryHour` a shop would
  // actually pick — the whole point of this cron is to report after closing), this is exactly
  // the business day that just wrapped up for the night.
  const businessDayKey = bangkokDateKeyWithCutoff(now, BUSINESS_DAY_FROM_HOUR);
  const { startMs, endMs } = businessDayBounds(businessDayKey, BUSINESS_DAY_FROM_HOUR);

  const settingsSnap = await db
    .collection(COLLECTIONS.notificationSettings)
    .where("enabled", "==", true)
    .get();

  let sent = 0;
  let skipped = 0;

  for (const doc of settingsSnap.docs) {
    const settings = doc.data() as Omit<NotificationSettings, "id">;
    const notSentToday = settings.lastDailySummaryDateKey !== businessDayKey;
    const isTheirHour = (settings.dailySummaryHour ?? DEFAULT_DAILY_SUMMARY_HOUR) === currentHour;
    if (
      !settings.telegramBotToken ||
      !settings.telegramChatId ||
      settings.notifyDailySummary === false ||
      !isTheirHour ||
      !notSentToday
    ) {
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

    // แยกเงินสด/เงินโอน — same cash-vs-QR-vs-other split `/admin/accounting`'s reconciliation
    // table uses, reusing that same pure `businessDaySales` with the same `BUSINESS_DAY_FROM_HOUR`
    // cutoff `orders` above was fetched with. Needs each `PaymentMethod`'s `code` (cash/qr), which
    // isn't stored on the order itself, so it's a small extra Admin SDK query alongside orders.
    const paymentMethodsSnap = await db.collection(COLLECTIONS.paymentMethods).where("shopId", "==", shopId).get();
    const paymentMethods = paymentMethodsSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as PaymentMethod);
    const [daySales] = businessDaySales(orders, paymentMethods, businessDayKey, businessDayKey, BUSINESS_DAY_FROM_HOUR);

    const summary = summarizeOrders(orders);
    // 10 — shop owner asked for "สินค้าขายดีสัก 10 รายการ" (was 5).
    const best = topProducts(orders, 10);

    const bestLines = best.length
      ? best.map((p, i) => `${i + 1}. ${p.productName} — ${p.qty} ชิ้น`).join("\n")
      : "ไม่มีรายการขาย";

    const otherLine = daySales.other > 0 ? `\nอื่นๆ: ${formatCurrency(daySales.other, "THB")}` : "";

    const text =
      `📊 สรุปยอดวันที่ ${businessDayKey}\n\n` +
      `ยอดขายรวม: ${formatCurrency(summary.revenue, "THB")}\n` +
      `เงินสด: ${formatCurrency(daySales.cash, "THB")}\n` +
      `เงินโอน: ${formatCurrency(daySales.qr, "THB")}${otherLine}\n` +
      `จำนวนบิล: ${summary.orderCount} บิล\n` +
      `ยอดเฉลี่ยต่อบิล: ${formatCurrency(summary.avgOrderValue, "THB")}\n\n` +
      `🏆 สินค้าขายดี\n${bestLines}`;

    await notifyShop(db, shopId, text, "dailySummary");
    await doc.ref.set({ lastDailySummaryDateKey: businessDayKey }, { merge: true });
    sent++;
  }

  return { sent, skipped };
}
