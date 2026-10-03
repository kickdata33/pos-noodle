import { bangkokDateKey, dateKeysBetween } from "./dateRange";
import type { DeliveryPayout, Expense, Order } from "@/types";

/**
 * Daily "กำไร/ขาดทุนสุทธิ รวม Delivery" (item: "เอายอดขาย delivery มาขึ้นโชว์ในหน้าสรุป และรวม
 * เข้าไป ดูว่าทั้งหมดขาดทุนเท่าไหร่ หรือได้เท่าไหร่ทั้งหมดในแต่ละวัน"). Deliberately plain-calendar
 * (`bangkokDateKey`, never a business-day/shift cutoff) — confirmed with the shop owner — because
 * `Expense.dateKey` and `DeliveryPayout.dateKey` are both already plain calendar dates (see their
 * own type comments for why), so comparing them against a shift-based POS sales figure would mix
 * two different definitions of "one day" on the same row. The existing shift-based reconciliation
 * table (`lib/pos/reconciliation.ts`) is untouched — this is a second, separate view answering a
 * different question ("did today make or lose money, all sources combined"), not a replacement.
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
  endKey: string
): DailyProfitLossRow[] {
  const posSalesByDay: Record<string, number> = {};
  for (const o of orders) {
    const key = bangkokDateKey(o.paidAt ?? o.createdAt);
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
