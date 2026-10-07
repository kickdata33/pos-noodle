import { bangkokDateKey, bangkokDateKeyWithCutoff, dateKeysBetween } from "./dateRange";
import type { DeliveryPayout, Expense, Order } from "@/types";

/**
 * Daily "กำไร/ขาดทุนสุทธิ รวม Delivery" (item: "เอายอดขาย delivery มาขึ้นโชว์ในหน้าสรุป และรวม
 * เข้าไป ดูว่าทั้งหมดขาดทุนเท่าไหร่ หรือได้เท่าไหร่ทั้งหมดในแต่ละวัน"). Defaults to plain-calendar
 * (`bangkokDateKey`) — confirmed with the shop owner — because `Expense.dateKey` and
 * `DeliveryPayout.dateKey` are both already plain calendar dates (see their own type comments for
 * why). The existing shift-based reconciliation table (`lib/pos/reconciliation.ts`) is untouched —
 * this is a second, separate view answering a different question ("did today make or lose money,
 * all sources combined"), not a replacement.
 *
 * `businessDayFromHour` (item: "มีฟังก์ชันเปิดปิด ยอดขาย 16:00-06:00 หรือตั้งเวลาเองได้") switches
 * *orders only* to the same shift-based day the reconciliation table above it uses, so the two can
 * be compared apples-to-apples when wanted: `undefined` (the default) keeps plain calendar days for
 * orders too, matching every order's own `paidAt`/`createdAt` exactly as before this option
 * existed. A number re-groups orders by `bangkokDateKeyWithCutoff` on their `paidAt`.
 *
 * `Expense`/`DeliveryPayout` always group by their own stored `dateKey` directly, regardless of
 * this toggle — same as `reconciliation.ts`'s `expensesForDay` and the รายจ่าย ledger list on
 * `/admin/accounting`, and deliberately so: unlike an `Order`, these rows carry an explicit
 * `dateKey` chosen by whoever logged them, so there's no timestamp ambiguity to resolve in the
 * first place. An earlier version of this file tried to re-derive a "business day" for these rows
 * from `createdAt` instead (via a since-removed `ledgerBusinessDayKey` helper) — meant to handle a
 * live entry made right after midnight, still part of the previous night's shift — but it quietly
 * mis-shifted the รายจ่ายประจำ auto-generator's rows too: that generator stamps `createdAt:
 * Date.now()` at whatever moment someone happens to have `/admin/accounting` open, which is not a
 * "live, in-the-moment" entry at all, yet looked exactly like one whenever that moment fell before
 * the cutoff hour — silently moving that day's recurring expense onto the *previous* business day
 * on this page and `/admin/reports`, while `/admin/accounting`'s own รายจ่าย list (and the
 * reconciliation table) kept showing it under its real date. Three views of "ค่าใช้จ่ายวันที่ X"
 * disagreeing with no visible reason was worse than the shift-disambiguation was worth, so every
 * ledger row now simply trusts its own `dateKey`, everywhere, always.
 *
 * Pure — no Firestore, no `Date.now()` — unit-tested directly (`scripts/dailyProfitLoss.test.ts`).
 */
export interface DailyProfitLossRow {
  dateKey: string;
  posSales: number;
  deliveryRevenue: number;
  expenses: number;
  /** posSales + deliveryRevenue - expenses. Not floored at zero — a real loss day should read as
   * a clear negative number, same philosophy as `computeSettlementPreview`'s `netPaid`. */
  net: number;
}

export function dailyProfitLossRows(
  orders: readonly Order[],
  deliveryPayouts: readonly DeliveryPayout[],
  expenses: readonly Expense[],
  startKey: string,
  endKey: string,
  businessDayFromHour?: number
): DailyProfitLossRow[] {
  const keyForTime = (epochMs: number): string =>
    businessDayFromHour != null ? bangkokDateKeyWithCutoff(epochMs, businessDayFromHour) : bangkokDateKey(epochMs);

  const posSalesByDay: Record<string, number> = {};
  for (const o of orders) {
    const key = keyForTime(o.paidAt ?? o.createdAt);
    if (key < startKey || key > endKey) continue;
    posSalesByDay[key] = (posSalesByDay[key] ?? 0) + o.total;
  }

  const deliveryByDay: Record<string, number> = {};
  for (const p of deliveryPayouts) {
    if (p.dateKey < startKey || p.dateKey > endKey) continue;
    deliveryByDay[p.dateKey] = (deliveryByDay[p.dateKey] ?? 0) + p.amount;
  }

  const expensesByDay: Record<string, number> = {};
  for (const e of expenses) {
    if (e.dateKey < startKey || e.dateKey > endKey) continue;
    expensesByDay[e.dateKey] = (expensesByDay[e.dateKey] ?? 0) + e.amount;
  }

  return dateKeysBetween(startKey, endKey).map((dateKey) => {
    const posSales = posSalesByDay[dateKey] ?? 0;
    const deliveryRevenue = deliveryByDay[dateKey] ?? 0;
    const dayExpenses = expensesByDay[dateKey] ?? 0;
    return { dateKey, posSales, deliveryRevenue, expenses: dayExpenses, net: posSales + deliveryRevenue - dayExpenses };
  });
}

/** Sums every row's own fields into one totals object for the range — same shape as a single
 * row so the UI can reuse one formatting path for both a day and the whole range's footer line. */
export function totalProfitLoss(rows: readonly DailyProfitLossRow[]): Omit<DailyProfitLossRow, "dateKey"> {
  return rows.reduce(
    (acc, r) => ({
      posSales: acc.posSales + r.posSales,
      deliveryRevenue: acc.deliveryRevenue + r.deliveryRevenue,
      expenses: acc.expenses + r.expenses,
      net: acc.net + r.net,
    }),
    { posSales: 0, deliveryRevenue: 0, expenses: 0, net: 0 }
  );
}
