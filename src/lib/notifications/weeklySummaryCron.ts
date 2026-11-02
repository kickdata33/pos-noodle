import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import { formatCurrency } from "@/lib/format";
import { addDaysToKey, bangkokDateKeyWithCutoff, bangkokWeekday } from "@/lib/pos/dateRange";
import { ledgerDayRows, ledgerRangeTotals } from "@/lib/pos/ledgerDay";
import { businessDayBounds, reconciliationRows } from "@/lib/pos/reconciliation";
import { topProducts } from "@/lib/pos/reports";
import type {
  BankTransfer,
  DailyFloat,
  DeliveryPayout,
  Expense,
  NotificationSettings,
  Order,
  PaymentMethod,
} from "@/types";

import { notifyShop } from "./notifyShop";

const DEFAULT_WEEKLY_SUMMARY_DAY_OF_WEEK = 0; // Monday — bangkokWeekday's own 0=Mon..6=Sun numbering

// Matches dailySummaryCron.ts's own constant — same 16:00 shift-start cutoff every business-day
// figure in this codebase uses (reconciliation, accounting, payroll). Duplicated rather than
// imported since neither file exports it as a shared constant and it's a one-line literal.
const BUSINESS_DAY_FROM_HOUR = 16;

const WEEKLY_WINDOW_DAYS = 7;

/**
 * สรุปยอดขายประจำสัปดาห์ (item: "เพิ่มสรุปรายสัปดาห์ ลงใน telegram เพิ่มเติมด้วย ยอดขายประจำสัปดาห์
 * รายจ่าย รายรับ ผลกำไร") — reuses the exact same pure pipeline `/admin/accounting` is built on
 * (`reconciliationRows` → `ledgerDayRows` → `ledgerRangeTotals`) rather than re-deriving sales/
 * expense/profit math a second time, so this can never quietly disagree with what the owner sees
 * on that page for the same week.
 *
 * **Why this is called from `/api/cron/daily-summary`'s route instead of getting its own
 * `vercel.json` cron entry**: this shop's Vercel plan (Hobby/free) already bit this codebase once
 * over cron limits — see `dailySummaryCron.ts`'s file comment, a shop's chosen summary hour
 * silently never fired because Hobby only triggers a cron entry once a day at one fixed time.
 * Hobby also caps the *number* of cron jobs a project can register at all, and this project
 * already uses both of its two slots (`/api/cron/billing`, `/api/cron/daily-summary`) — so a
 * third `vercel.json` entry risks silently failing to deploy or register, the same invisible-
 * failure shape as the hour-mismatch bug, just one layer earlier. Piggybacking this on the one
 * cron slot already proven to fire reliably sidesteps that risk entirely: every day it fires, it
 * independently checks whether *today* happens to be each shop's chosen weekday. Unlike
 * `dailySummaryHour` (which only actually works at whatever single hour `vercel.json` happens to
 * fire at), `weeklySummaryDayOfWeek` works correctly for *any* day the owner picks, since the
 * cron already runs every single calendar day — only the time-of-day is pinned to the daily
 * cron's one fixed fire time (06:00 Bangkok right now).
 *
 * Reports on the trailing 7 business days ending with whichever business day most recently
 * closed (same "16:00-cutoff shift" business day the daily summary and the accounting page use),
 * not a Monday-aligned calendar week — so it works the same regardless of which weekday the shop
 * picked to receive it, and never needs a special case for a shop's very first week.
 */
export async function runWeeklySummaryCron(
  db: Firestore,
  // Bypasses the "is today my chosen weekday" check — for a manual curl/catch-up send. The
  // `notSentThisWeek` dedupe guard still applies even when forced, so this can never double-send
  // the same week a real scheduled run already covered. Same shape as `runDailySummaryCron`'s
  // own `force` option.
  options: { force?: boolean } = {}
): Promise<{ sent: number; skipped: number }> {
  const now = Date.now();
  const currentWeekday = bangkokWeekday(now); // 0=Mon .. 6=Sun
  const businessDayKey = bangkokDateKeyWithCutoff(now, BUSINESS_DAY_FROM_HOUR);
  const startKey = addDaysToKey(businessDayKey, -(WEEKLY_WINDOW_DAYS - 1));
  const { startMs } = businessDayBounds(startKey, BUSINESS_DAY_FROM_HOUR);
  const { endMs } = businessDayBounds(businessDayKey, BUSINESS_DAY_FROM_HOUR);

  const settingsSnap = await db.collection(COLLECTIONS.notificationSettings).where("enabled", "==", true).get();

  let sent = 0;
  let skipped = 0;

  for (const doc of settingsSnap.docs) {
    const settings = doc.data() as Omit<NotificationSettings, "id">;
    const notSentThisWeek = settings.lastWeeklySummaryWeekKey !== businessDayKey;
    const isTheirWeekday =
      options.force || currentWeekday === (settings.weeklySummaryDayOfWeek ?? DEFAULT_WEEKLY_SUMMARY_DAY_OF_WEEK);
    if (
      !settings.telegramBotToken ||
      !settings.telegramChatId ||
      // Opt-in, unlike the other notify* switches — see `NotificationSettings.notifyWeeklySummary`'s
      // comment on why `undefined` means off here specifically.
      settings.notifyWeeklySummary !== true ||
      !isTheirWeekday ||
      !notSentThisWeek
    ) {
      skipped++;
      continue;
    }
    const shopId = doc.id;

    const [ordersSnap, paymentMethodsSnap, transfersSnap, expensesSnap, floatsSnap, deliveryPayoutsSnap, modifierGroupsSnap] =
      await Promise.all([
        db
          .collection(COLLECTIONS.orders)
          .where("shopId", "==", shopId)
          .where("status", "==", "PAID")
          .where("paidAt", ">=", startMs)
          .where("paidAt", "<=", endMs)
          .get(),
        db.collection(COLLECTIONS.paymentMethods).where("shopId", "==", shopId).get(),
        db
          .collection(COLLECTIONS.bankTransfers)
          .where("shopId", "==", shopId)
          .where("businessDayKey", ">=", startKey)
          .where("businessDayKey", "<=", businessDayKey)
          .get(),
        db
          .collection(COLLECTIONS.expenses)
          .where("shopId", "==", shopId)
          .where("dateKey", ">=", startKey)
          .where("dateKey", "<=", businessDayKey)
          .get(),
        db
          .collection(COLLECTIONS.dailyFloats)
          .where("shopId", "==", shopId)
          .where("businessDayKey", ">=", startKey)
          .where("businessDayKey", "<=", businessDayKey)
          .get(),
        db
          .collection(COLLECTIONS.deliveryPayouts)
          .where("shopId", "==", shopId)
          .where("dateKey", ">=", startKey)
          .where("dateKey", "<=", businessDayKey)
          .get(),
        db.collection(COLLECTIONS.modifierGroups).where("shopId", "==", shopId).where("splitSalesReport", "==", true).get(),
      ]);

    const orders = ordersSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as Order);
    const paymentMethods = paymentMethodsSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as PaymentMethod);
    const transfers = transfersSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as BankTransfer);
    const expenses = expensesSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as Expense);
    const floats = floatsSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as DailyFloat);
    const deliveryPayouts = deliveryPayoutsSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as DeliveryPayout);
    const splitGroupIds = new Set(modifierGroupsSnap.docs.map((d) => d.id));

    // Same signed cash/transfer correction accounting already applies — see
    // `DailyFloat.cashTransferAdjustment`'s comment and the accounting page's own `cashTransferAdjustments`.
    const cashTransferAdjustments: Record<string, number> = {};
    for (const f of floats) {
      if (f.cashTransferAdjustment) cashTransferAdjustments[f.businessDayKey] = f.cashTransferAdjustment;
    }

    const reconciliation = reconciliationRows(
      orders,
      paymentMethods,
      transfers,
      expenses,
      startKey,
      businessDayKey,
      BUSINESS_DAY_FROM_HOUR,
      cashTransferAdjustments
    );
    const ledgerRows = ledgerDayRows(reconciliation, floats, expenses, deliveryPayouts);
    const totals = ledgerRangeTotals(ledgerRows);

    // 5 — shop owner's confirmed choice for the weekly digest (the daily summary separately
    // shows 10; a week's worth repeating the same 10 every day added nothing a shorter list
    // wouldn't already say).
    const best = topProducts(orders, 5, splitGroupIds);
    const bestLines = best.length
      ? best.map((p, i) => `${i + 1}. ${p.productName} — ${p.qty} ชิ้น`).join("\n")
      : "ไม่มีรายการขาย";

    // "เข้าบัญชีจริง" only reads as a second, confusing near-duplicate of "ยอดขายรวม" when the two
    // numbers actually differ (some QR sales from the week haven't been matched by a logged bank
    // transfer yet) — so it's only printed as its own line in that case, with an explicit reason
    // attached, rather than always showing two almost-identical baht figures back to back (the
    // exact confusion the accounting page's v1→v2 redesign this session just fixed once already).
    const receivedDiffersFromSales = Math.abs(totals.receivedTotal - totals.salesTotal) >= 1;
    const receivedLine = receivedDiffersFromSales
      ? `เข้าบัญชีจริง: ${formatCurrency(totals.receivedTotal, "THB")} (มี QR ที่ยังไม่โอนเข้าบัญชีรวมอยู่ในยอดขาย)\n`
      : "";

    const text =
      `📅 สรุปยอดประจำสัปดาห์ ${startKey} – ${businessDayKey}\n\n` +
      `ยอดขายรวม: ${formatCurrency(totals.salesTotal, "THB")}\n` +
      receivedLine +
      `รายจ่ายรวม: ${formatCurrency(totals.expenses, "THB")}\n` +
      `${totals.netProfit >= 0 ? "✅" : "⚠️"} กำไร/ขาดทุนสุทธิ: ${formatCurrency(totals.netProfit, "THB")}\n\n` +
      `🏆 สินค้าขายดีประจำสัปดาห์\n${bestLines}`;

    await notifyShop(db, shopId, text, "weeklySummary");
    await doc.ref.set({ lastWeeklySummaryWeekKey: businessDayKey }, { merge: true });
    sent++;
  }

  return { sent, skipped };
}
