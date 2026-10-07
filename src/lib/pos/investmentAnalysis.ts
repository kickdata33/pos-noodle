import { addDaysToKey, bangkokDateKey, dateKeysBetween } from "./dateRange";
import type { DeliveryPayout, Expense, InvestmentItem, Order } from "@/types";

/**
 * สรุปการลงทุน — pure calculations behind `/admin/investment` (item: "อยากได้ หน้าสรุปการลงทุน
 * ไม่ว่าจะเป็นค่าเซ้ง ค่าของ ที่ลงทุนไปทั้งหมด และวิเคราะห์ จากรายรับรายจ่าย ระยะเวลาคืนทุน ยอดขายที่
 * ควรจะมี เฉลี่ย ต่อวันต่อเดือน"). Two kinds of analysis, both wanted — asked, and the shop owner's
 * own pick when offered a choice ("ทั้งสองแบบ (แนะนำ)"):
 *
 *  1. `summarizeHistoricalPerformance` + `computePaybackProgress` — averages the shop's *actual*
 *     recorded revenue/expenses since it started selling, and projects forward from there: "ถ้า
 *     ขายได้เท่าที่ขายได้จริงตอนนี้ไปเรื่อยๆ จะคืนทุนเมื่อไหร่".
 *  2. `computeTargetPaybackPlan` — works backwards from a payback period the owner picks (e.g.
 *     "อยากคืนทุนภายใน 12 เดือน"), using the shop's historical average daily expense as its
 *     operating-cost assumption (the one cost figure we actually have), to say what *revenue*
 *     that target requires: "ต้องขายเท่าไหร่ต่อวัน/เดือน ถึงจะคืนทุนได้ตามที่ตั้งใจ".
 *
 * `expenses` here means *operating* cost only. `InvestmentItem` is a deliberately separate
 * collection (see `types/investment.ts`) that never appears inside an `Expense` row, so summing
 * `expenses` can never double-count money already counted as invested capital, and investment
 * rows never reduce a day's operating P&L.
 *
 * Revenue/net use the same definition `dailyProfitLoss.ts` already uses for "net กำไร/ขาดทุน"
 * (order `total` + `DeliveryPayout.amount`, minus `Expense.amount`) — deliberately reusing that
 * formula rather than inventing a second one, so "net" means the same thing on both pages.
 *
 * Pure — no Firestore, no `Date.now()`; every "as of today" anchor (`asOfKey`) is passed in by
 * the caller, same philosophy as `dailyProfitLossRows`'s `startKey`/`endKey`, so this stays
 * unit-testable. Unit tests: `scripts/investmentAnalysis.test.ts`.
 */

/** Used to turn a day-based figure into a "ต่อเดือน" one throughout this file — a plain 30-day
 * month, not a specific calendar month, same simplification `recurringExpenses.ts` uses for a
 * "เฉลี่ยต่อวัน" recurring cost. Exported so the UI can convert a user-picked payback period in
 * months into the `targetDays` `computeTargetPaybackPlan` expects, with one shared constant. */
export const DAYS_PER_MONTH = 30;

export interface InvestmentTotals {
  totalInvested: number;
  itemCount: number;
  /** Earliest/latest `dateKey` across every investment item, lexicographic (safe for
   * "YYYY-MM-DD"). `null` when there are no items yet. */
  earliestDateKey: string | null;
  latestDateKey: string | null;
}

/** Sums every logged investment item (ค่าเซ้ง, ค่าตกแต่ง/อุปกรณ์, ของเริ่มต้น, ...) into one total —
 * "ที่ลงทุนไปทั้งหมด". */
export function summarizeInvestments(items: readonly InvestmentItem[]): InvestmentTotals {
  if (items.length === 0) {
    return { totalInvested: 0, itemCount: 0, earliestDateKey: null, latestDateKey: null };
  }
  let totalInvested = 0;
  let earliestDateKey = items[0].dateKey;
  let latestDateKey = items[0].dateKey;
  for (const item of items) {
    totalInvested += item.amount;
    if (item.dateKey < earliestDateKey) earliestDateKey = item.dateKey;
    if (item.dateKey > latestDateKey) latestDateKey = item.dateKey;
  }
  return { totalInvested, itemCount: items.length, earliestDateKey, latestDateKey };
}

export interface HistoricalPerformance {
  /** The earliest `dateKey` among every order/expense/delivery-payout row given — the day the
   * shop's recorded operating history starts. `null` when there's no data at all yet. */
  startDateKey: string | null;
  /** Inclusive calendar-day count from `startDateKey` through `asOfKey` — the denominator behind
   * every "เฉลี่ยต่อวัน" figure below. 0 when `startDateKey` is `null`. */
  daysOfHistory: number;
  totalRevenue: number;
  totalExpenses: number;
  /** totalRevenue - totalExpenses, same meaning as `DailyProfitLossRow.net` summed over the
   * whole history. Not floored at zero. */
  totalNet: number;
  avgRevenuePerDay: number;
  avgExpensePerDay: number;
  avgNetPerDay: number;
  avgNetPerMonth: number;
}

/** Averages the shop's whole recorded sales/expense history up to `asOfKey` (the caller's
 * "today", Bangkok calendar date) — "ยอดขายเฉลี่ย...ต่อวันต่อเดือน", from what actually happened. */
export function summarizeHistoricalPerformance(
  orders: readonly Order[],
  deliveryPayouts: readonly DeliveryPayout[],
  expenses: readonly Expense[],
  asOfKey: string
): HistoricalPerformance {
  let startDateKey: string | null = null;
  const consider = (key: string) => {
    if (startDateKey === null || key < startDateKey) startDateKey = key;
  };

  let totalRevenue = 0;
  for (const o of orders) {
    consider(bangkokDateKey(o.paidAt ?? o.createdAt));
    totalRevenue += o.total;
  }
  for (const p of deliveryPayouts) {
    consider(p.dateKey);
    totalRevenue += p.amount;
  }

  let totalExpenses = 0;
  for (const e of expenses) {
    consider(e.dateKey);
    totalExpenses += e.amount;
  }

  const totalNet = totalRevenue - totalExpenses;
  // Guard against a caller passing an `asOfKey` before the data's own start (shouldn't happen —
  // "today" should never precede history — but `dateKeysBetween` would just return an empty list
  // rather than a negative count, so floor at 1 to keep every average below finite and safe).
  const daysOfHistory = startDateKey === null ? 0 : Math.max(1, dateKeysBetween(startDateKey, asOfKey).length);

  const perDay = (total: number): number => (daysOfHistory > 0 ? total / daysOfHistory : 0);
  const avgRevenuePerDay = perDay(totalRevenue);
  const avgExpensePerDay = perDay(totalExpenses);
  const avgNetPerDay = perDay(totalNet);

  return {
    startDateKey,
    daysOfHistory,
    totalRevenue,
    totalExpenses,
    totalNet,
    avgRevenuePerDay,
    avgExpensePerDay,
    avgNetPerDay,
    avgNetPerMonth: avgNetPerDay * DAYS_PER_MONTH,
  };
}

export interface PaybackProgress {
  totalInvested: number;
  /** Net profit earned since the shop started selling (`HistoricalPerformance.totalNet`) — what
   * has actually gone toward recovering the investment so far. */
  cumulativeNet: number;
  /** totalInvested - cumulativeNet. Negative once the investment is fully recovered — a real
   * surplus should read as a clear negative number, not clamp to zero (same philosophy as
   * `DailyProfitLossRow.net`). */
  amountRemaining: number;
  /** cumulativeNet / totalInvested * 100. `null` when `totalInvested` is 0 — nothing to recover,
   * so "percent recovered" has no meaning. */
  percentRecovered: number | null;
  isFullyRecovered: boolean;
  /** Projected additional days (from `asOfKey`) until `amountRemaining` reaches 0, holding
   * `avgNetPerDay` steady. `null` once already recovered, or when `avgNetPerDay <= 0` (at the
   * current average pace the investment is never recovered, so there's no date to project). */
  estimatedDaysRemaining: number | null;
  /** `asOfKey` shifted forward by `estimatedDaysRemaining` Bangkok calendar days. `null` under
   * the same conditions as `estimatedDaysRemaining`. */
  estimatedPaybackDateKey: string | null;
}

/** "ระยะเวลาคืนทุน" measured against what the shop has actually earned so far, projected forward
 * at its own historical average pace. */
export function computePaybackProgress(
  totalInvested: number,
  performance: HistoricalPerformance,
  asOfKey: string
): PaybackProgress {
  const cumulativeNet = performance.totalNet;
  const amountRemaining = totalInvested - cumulativeNet;
  const isFullyRecovered = totalInvested <= 0 || amountRemaining <= 0;
  const percentRecovered = totalInvested > 0 ? (cumulativeNet / totalInvested) * 100 : null;

  let estimatedDaysRemaining: number | null = null;
  let estimatedPaybackDateKey: string | null = null;
  if (!isFullyRecovered && performance.avgNetPerDay > 0) {
    estimatedDaysRemaining = Math.ceil(amountRemaining / performance.avgNetPerDay);
    estimatedPaybackDateKey = addDaysToKey(asOfKey, estimatedDaysRemaining);
  }

  return {
    totalInvested,
    cumulativeNet,
    amountRemaining,
    percentRecovered,
    isFullyRecovered,
    estimatedDaysRemaining,
    estimatedPaybackDateKey,
  };
}

export interface TargetPaybackPlan {
  /** Clamped to at least 1 — a 0 or negative target period has no meaningful required pace. */
  targetDays: number;
  /** totalInvested / targetDays — the net profit per day this target requires. */
  requiredNetPerDay: number;
  /** requiredNetPerDay + the shop's historical average daily expense — the *revenue* per day
   * this target actually requires, since revenue has to cover operating costs before anything
   * counts toward payback. "ยอดขายที่ควรจะมี...ต่อวัน". */
  requiredRevenuePerDay: number;
  requiredRevenuePerMonth: number;
  /** The shop's actual historical average revenue per day, for comparison. */
  actualAvgRevenuePerDay: number;
  /** requiredRevenuePerDay - actualAvgRevenuePerDay. Positive = short of the pace this target
   * needs at today's average; zero or negative = already selling enough to beat it. */
  gapRevenuePerDay: number;
}

/** Works backwards from a payback period the owner picks (`targetDays`) to the sales pace that
 * period requires — "ถ้าอยากคืนทุนภายใน N วัน ต้องขายเท่าไหร่ต่อวัน/เดือน". */
export function computeTargetPaybackPlan(
  totalInvested: number,
  targetDays: number,
  performance: HistoricalPerformance
): TargetPaybackPlan {
  const safeTargetDays = Math.max(1, targetDays);
  const requiredNetPerDay = totalInvested / safeTargetDays;
  const requiredRevenuePerDay = requiredNetPerDay + performance.avgExpensePerDay;
  return {
    targetDays: safeTargetDays,
    requiredNetPerDay,
    requiredRevenuePerDay,
    requiredRevenuePerMonth: requiredRevenuePerDay * DAYS_PER_MONTH,
    actualAvgRevenuePerDay: performance.avgRevenuePerDay,
    gapRevenuePerDay: requiredRevenuePerDay - performance.avgRevenuePerDay,
  };
}
