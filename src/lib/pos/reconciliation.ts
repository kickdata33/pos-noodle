import type { BankTransfer, Expense, Order, PaymentMethod } from "@/types";
import { bangkokDateKeyWithCutoff, bangkokDayBounds, dateKeysBetween } from "./dateRange";

/**
 * บัญชีรายรับ-รายจ่ายรายวัน — reconciles what the POS says was sold against what actually landed
 * in the bank, for a shop whose "day" (16:00–04:00, spanning midnight, labeled by the date it
 * *starts* on — see `bangkokDateKeyWithCutoff`'s comment) doesn't line up with its payment
 * provider's own settlement cutoff (K SHOP settles PromptPay/K PLUS at a fixed 23:00 every
 * calendar day). Concretely: one business day's QR sales get split into *two* separate bank
 * transfers on two different calendar dates — the 16:00–23:00 portion transfers that same
 * calendar night (23:00 on the label date itself), the 23:00–04:00 portion (already past
 * midnight) doesn't transfer until 23:00 the *next* calendar night (23:00 on label date + 1).
 * Without this file, that gap reads as "980 baht missing" instead of what it actually is: a
 * transfer that just hasn't happened yet. Everything here is pure/synchronous and unit-tested
 * (`scripts/reconciliation.test.ts`) the same way `lib/pos/reports.ts` is.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function recognizedAt(order: Order): number {
  return order.paidAt ?? order.createdAt;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The real [startMs, endMs] time span a business-day *label* key covers — purely informational
 * (shown next to the "log a transfer" form so a person can double check which business day a
 * bank line actually belongs to; see `BankTransfer.businessDayKey`'s comment for why matching
 * itself is never done by time-window math). `bangkokDateKeyWithCutoff` (see that function's own
 * comment) labels a business day by the calendar date it *starts* on — a shift starting 16:00 on
 * the 18th and running to 04:00 on the 19th is labeled "18", not "19" — so the span runs forward
 * from there: from `fromHour` on the label date itself, to `fromHour` on the day *after* (a full
 * 24h window; see `dailySales`'s comment for why the grouping only needs one boundary hour, not
 * two).
 */
export function businessDayBounds(labelKey: string, fromHour: number): { startMs: number; endMs: number } {
  const startMs = bangkokDayBounds(labelKey).startMs + fromHour * HOUR_MS;
  return { startMs, endMs: startMs + DAY_MS - 1 };
}

export interface BusinessDaySales {
  dateKey: string;
  cash: number;
  qr: number;
  /** Any payment method that isn't tagged "cash" or "qr" (e.g. Delivery, a custom method, or a
   * paid order with no payment method recorded at all) — never silently dropped from the total. */
  other: number;
  total: number;
  orderCount: number;
}

function classifyMethod(order: Order, methodsById: Map<string, PaymentMethod>): "cash" | "qr" | "other" {
  const method = order.paymentMethodId ? methodsById.get(order.paymentMethodId) : undefined;
  if (method?.code === "cash") return "cash";
  if (method?.code === "qr") return "qr";
  return "other";
}

/** Same shape/intent as `reports.ts`'s `dailySales`, but split by payment method (cash vs QR vs
 * other) and always grouped by business day, never plain midnight — this table only exists to
 * answer the bank-reconciliation question, which only makes sense in shift terms. */
export function businessDaySales(
  orders: Order[],
  paymentMethods: PaymentMethod[],
  startKey: string,
  endKey: string,
  fromHour: number
): BusinessDaySales[] {
  const methodsById = new Map(paymentMethods.map((m) => [m.id, m]));
  const byDay = new Map<string, BusinessDaySales>();
  for (const key of dateKeysBetween(startKey, endKey)) {
    byDay.set(key, { dateKey: key, cash: 0, qr: 0, other: 0, total: 0, orderCount: 0 });
  }
  for (const order of orders) {
    const key = bangkokDateKeyWithCutoff(recognizedAt(order), fromHour);
    const entry = byDay.get(key);
    if (!entry) continue; // outside the requested range — same defensive stance as `dailySales`
    const bucket = classifyMethod(order, methodsById);
    entry[bucket] = round2(entry[bucket] + order.total);
    entry.total = round2(entry.total + order.total);
    entry.orderCount += 1;
  }
  return [...byDay.values()];
}

/** Sum of bank transfers logged against a given business-day label — a plain field match, not a
 * time-window guess (see `BankTransfer.businessDayKey`'s comment for why). */
export function transfersForBusinessDay(transfers: BankTransfer[], labelKey: string): number {
  return round2(transfers.filter((t) => t.businessDayKey === labelKey).reduce((sum, t) => sum + t.amount, 0));
}

/** Sum of expenses logged against a given date. Matched by plain `dateKey` equality (the day the
 * expense was actually paid) rather than the business-day time span — an expense doesn't need
 * the 16:00–04:00 shift logic sales do, it just belongs to whatever calendar day the owner
 * recorded it under. */
export function expensesForDay(expenses: Expense[], dateKey: string): number {
  return round2(expenses.filter((e) => e.dateKey === dateKey).reduce((sum, e) => sum + e.amount, 0));
}

export interface ReconciliationRow {
  dateKey: string;
  cashSales: number;
  qrSales: number;
  otherSales: number;
  totalSales: number;
  transferred: number;
  /** QR sales not yet matched by a logged transfer — the number that used to read as "missing".
   * Floored at 0: a transfer logged *larger* than that day's QR sales (e.g. it actually belongs
   * to the previous day's leftover portion) never shows as a negative "pending" — see
   * `overTransferred` for that case instead of just silently dropping it. */
  pendingTransfer: number;
  /** The flip side of `pendingTransfer`, floored at 0 the same way: how much *more* was logged
   * as transferred than this day's own QR sales account for. This should basically never happen
   * for a correctly-entered day (a business day's transfer can be logged late, but never more
   * than it actually sold), so a nonzero value here is a real red flag worth surfacing rather
   * than letting `pendingTransfer` silently swallow it as "0, all settled" — it has caught a
   * real bug (a cash-deposit row mistakenly logged into the QR-transfer table) and, separately,
   * QR sales the POS never recorded at all (a bill paid by QR but rung in as another method, or
   * not rung in at all) — both surface as this same symptom and need to be told apart by hand. */
  overTransferred: number;
  expenses: number;
  /** totalSales - expenses for this business day — cash + QR + other, regardless of whether the
   * QR portion has actually landed in the bank yet (that's what `pendingTransfer` is for). */
  net: number;
  /** True once every baht of this day's QR sales has a matching logged transfer (within a small
   * rounding tolerance) — drives the "ครบ"/"รอ" badge. */
  settled: boolean;
}

/** Rounding/float slop tolerance in baht — never a real discrepancy worth flagging as "รอ". */
const SETTLE_TOLERANCE_THB = 1;

export function reconciliationRows(
  orders: Order[],
  paymentMethods: PaymentMethod[],
  transfers: BankTransfer[],
  expenses: Expense[],
  startKey: string,
  endKey: string,
  fromHour: number
): ReconciliationRow[] {
  return businessDaySales(orders, paymentMethods, startKey, endKey, fromHour).map((day) => {
    const transferred = transfersForBusinessDay(transfers, day.dateKey);
    const pendingTransfer = round2(Math.max(0, day.qr - transferred));
    const overTransferred = round2(Math.max(0, transferred - day.qr));
    const dayExpenses = expensesForDay(expenses, day.dateKey);
    return {
      dateKey: day.dateKey,
      cashSales: day.cash,
      qrSales: day.qr,
      otherSales: day.other,
      totalSales: day.total,
      transferred,
      pendingTransfer,
      overTransferred,
      expenses: dayExpenses,
      net: round2(day.total - dayExpenses),
      settled: pendingTransfer <= SETTLE_TOLERANCE_THB,
    };
  });
}
