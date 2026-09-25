import { DELIVERY_PLATFORMS, type DeliveryPayout, type DeliveryPlatform, type Order, type PaymentMethod } from "@/types";
import { bangkokDateKey, dateKeysBetween } from "./dateRange";

/**
 * ยอดขาย Delivery — reconciles what the POS recorded as delivery-platform sales against what
 * each aggregator has actually paid out (item: modeled on the shop's own Grab/Line man/Shopee
 * tracking spreadsheet). Deliberately grouped by plain calendar `dateKey`, never a business-day
 * shift the way `reconciliation.ts`'s QR figures are — a delivery aggregator pays out on its own
 * periodic schedule with no fixed relationship to the shop's 16:00 shift start, so there's no
 * shift-crossing cutoff problem to correct for here the way K SHOP's 23:00 cutoff needed. Pure/
 * synchronous, unit-tested the same way `reconciliation.ts` is (`scripts/delivery.test.ts`).
 */

function recognizedAt(order: Order): number {
  return order.paidAt ?? order.createdAt;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyPlatformTotals(): Record<DeliveryPlatform, number> {
  return Object.fromEntries(DELIVERY_PLATFORMS.map((p) => [p, 0])) as Record<DeliveryPlatform, number>;
}

/** Loosely matches an order's snapshotted channel name to one of the shop's known delivery
 * platforms — a channel renamed or retyped slightly ("Line Man", "LINEMAN") should still land in
 * the right bucket rather than silently falling into "other" over a naming mismatch. Only ever
 * called for orders already confirmed to be paid via the "delivery" payment method (see
 * `deliverySalesByPlatform`), so a dine-in order never reaches this just because its channel name
 * happens to contain one of these words. */
function matchPlatform(channelName: string): DeliveryPlatform {
  const name = channelName.toLowerCase();
  if (name.includes("grab")) return "grab";
  if (name.includes("line")) return "lineman";
  if (name.includes("shopee")) return "shopeeFood";
  return "other";
}

export interface DeliverySalesRow {
  dateKey: string;
  byPlatform: Record<DeliveryPlatform, number>;
  total: number;
  orderCount: number;
}

/** Same shape/intent as `reconciliation.ts`'s `businessDaySales`, but split by delivery platform
 * instead of cash/QR, and grouped by plain calendar date (see this file's comment for why). Only
 * counts orders actually paid through the "delivery" `PaymentMethod` — an order on a channel
 * named "Grab" that was somehow paid cash never counts here, matching how `businessDaySales`
 * classifies strictly by payment method, never by channel. */
export function deliverySalesByPlatform(
  orders: Order[],
  paymentMethods: PaymentMethod[],
  startKey: string,
  endKey: string
): DeliverySalesRow[] {
  const methodsById = new Map(paymentMethods.map((m) => [m.id, m]));
  const byDay = new Map<string, DeliverySalesRow>();
  for (const key of dateKeysBetween(startKey, endKey)) {
    byDay.set(key, { dateKey: key, byPlatform: emptyPlatformTotals(), total: 0, orderCount: 0 });
  }
  for (const order of orders) {
    const method = order.paymentMethodId ? methodsById.get(order.paymentMethodId) : undefined;
    if (method?.code !== "delivery") continue;
    const key = bangkokDateKey(recognizedAt(order));
    const entry = byDay.get(key);
    if (!entry) continue; // outside the requested range — same defensive stance as businessDaySales
    const platform = matchPlatform(order.channelName);
    entry.byPlatform[platform] = round2(entry.byPlatform[platform] + order.total);
    entry.total = round2(entry.total + order.total);
    entry.orderCount += 1;
  }
  return [...byDay.values()];
}

/** Sum of logged payouts for one platform within a plain date range — a plain field match, not a
 * time-window guess, same reasoning as `reconciliation.ts`'s `transfersForBusinessDay`. */
export function deliveryPayoutTotal(payouts: DeliveryPayout[], platform: DeliveryPlatform, startKey: string, endKey: string): number {
  return round2(
    payouts.filter((p) => p.platform === platform && p.dateKey >= startKey && p.dateKey <= endKey).reduce((sum, p) => sum + p.amount, 0)
  );
}

export interface DeliveryPlatformSummary {
  platform: DeliveryPlatform;
  sales: number;
  payouts: number;
  /** sales - payouts over the whole range, never floored at 0 — unlike `overTransferred` in
   * `reconciliation.ts`, a delivery payout logged *larger* than sales-to-date isn't necessarily a
   * bug: aggregators commonly hold a rolling reserve and settle a lump sum that covers more than
   * one visible period, so this can legitimately run negative for a while. */
  outstanding: number;
}

/** One row per platform, summed across the whole visible range — a range-level comparison, not a
 * per-day one, since (unlike QR/K SHOP) a delivery payout's date has no reliable relationship to
 * which day's sales it actually covers. */
export function deliveryRangeSummary(rows: DeliverySalesRow[], payouts: DeliveryPayout[], startKey: string, endKey: string): DeliveryPlatformSummary[] {
  return DELIVERY_PLATFORMS.map((platform) => {
    const sales = round2(rows.reduce((sum, r) => sum + r.byPlatform[platform], 0));
    const payoutTotal = deliveryPayoutTotal(payouts, platform, startKey, endKey);
    return { platform, sales, payouts: payoutTotal, outstanding: round2(sales - payoutTotal) };
  });
}
