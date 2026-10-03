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
 * every figure on this view to the same shift-based day the reconciliation table above it uses,
 * so the two can be compared apples-to-apples when wanted: `undefined` (the default) keeps plain
 * calendar days for everything, matching every record's own stored `dateKey`/timestamp exactly as
 * before this option existed. A number re-groups orders by `bangkokDateKeyWithCutoff` on their
 * `paidAt`, and re-groups `Expense`/`DeliveryPayout` the same way but using their `createdAt`
 * (the actual moment they were logged) instead of their stored `dateKey` — same fix, and same
 * reasoning, as the "ดูตามช่วงเวลาทำการ" toggle on `/admin/reports` (see that page's
 * `totalExpenses`/`deliveryRevenue` comment): a plain `dateKey` comparison can't answer "which
 * shift does this belong to" on its own, only a real timestamp can.
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
    const key = businessDayFromHour != null ? keyForTime(p.createdAt) : p.dateKey;
    if (key < startKey || key > endKey) continue;
    deliveryByDay[key] = (deliveryByDay[key] ?? 0) + p.amount;
  }

  const expensesByDay: Record<string, number> = {};
  for (const e of expenses) {
    const key = businessDayFromHour != null ? keyForTime(e.createdAt) : e.dateKey;
    if (key < startKey || key > endKey) continue;
    expensesByDay[key] = (expensesByDay[key] ?? 0) + e.amount;
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
