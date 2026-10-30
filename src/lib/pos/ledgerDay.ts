import type { DailyFloat, DeliveryPayout, Expense } from "@/types";
import { checkCashFloat, combinedDifference } from "./dailyFloat";
import type { ReconciliationRow } from "./reconciliation";

/**
 * One row per business day for the consolidated single-table ledger (`/admin/accounting`) —
 * folds Delivery revenue and the cash-float check into `reconciliationRows`' existing cash/QR
 * figures, so the owner reads one number per concept instead of piecing it together across four
 * separate tables plus a detail dialog (item: "ช่วยออกแบบหน้ากรอกข้อมูลเพื่อให้ทำบัญชี ง่ายดูได้จากตาราง
 * เดียว ... อยากให้ delivery รวมไปด้วยจะได้แบบ ดูแค่ตารางเดียว ยอดสุทธิไปเลย หักขาด หักเกิน ระบุชัดเจน").
 * Pure/synchronous, unit-tested directly (`scripts/ledgerDay.test.ts`) the same way every other
 * `lib/pos` calculation is.
 *
 * Delivery is folded in by plain calendar `dateKey`, summing `DeliveryPayout.amount` the exact
 * same way `dailyProfitLossRows` already does (that attribution was confirmed with the shop
 * owner there) — a payout's logged date has no reliable relationship to which business-day shift
 * actually earned it (an aggregator settles a lump sum on its own schedule, not the shop's
 * 16:00-start shift), so this merge accepts the same small, already-documented imprecision rather
 * than inventing a false day-level precision `deliveryRangeSummary` deliberately avoids. For the
 * same reason, there's no attempt to show a per-day "Delivery ค้างรับ" split here — that only
 * makes sense range-wide (see `/admin/delivery`'s own per-platform summary).
 */
export interface LedgerDayRow extends ReconciliationRow {
  deliveryRevenue: number;
  /** totalSales + deliveryRevenue — "ยอดขาย" as shown in the single table, Delivery already folded in. */
  salesTotal: number;
  /** netReceived + deliveryRevenue — "เข้าบัญชีจริง" as shown in the single table. */
  receivedTotal: number;
  startingCash: number | null;
  cashMovedOut: number;
  /** ปลายกะที่นับได้จริง, AFTER cashMovedOut was already set aside — see `DailyFloat.closingCashCounted`'s comment. */
  closingCashCounted: number | null;
  expectedCashBeforeMoveOut: number | null;
  cashDifference: number | null;
  /** ส่วนต่างรวม (เงินสด+โอน) — `null` (not 0) until the day's cash has actually been counted. */
  combined: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function cashExpensesForDay(expenses: readonly Expense[], dateKey: string): number {
  return round2(
    expenses.filter((e) => e.dateKey === dateKey && e.paymentMethod === "cash").reduce((sum, e) => sum + e.amount, 0)
  );
}

export function ledgerDayRows(
  rows: readonly ReconciliationRow[],
  floats: readonly DailyFloat[],
  expenses: readonly Expense[],
  deliveryPayouts: readonly DeliveryPayout[]
): LedgerDayRow[] {
  const floatsByDay = new Map(floats.map((f) => [f.businessDayKey, f]));
  const deliveryByDay: Record<string, number> = {};
  for (const p of deliveryPayouts) {
    deliveryByDay[p.dateKey] = round2((deliveryByDay[p.dateKey] ?? 0) + p.amount);
  }

  return rows.map((r) => {
    const float = floatsByDay.get(r.dateKey) ?? null;
    const deliveryRevenue = deliveryByDay[r.dateKey] ?? 0;
    const cashMovedOut = float?.cashMovedOut ?? 0;
    const cashExpenses = cashExpensesForDay(expenses, r.dateKey);
    const { expectedCashBeforeMoveOut, cashDifference } = checkCashFloat(
      float?.startingCash ?? null,
      r.cashSales,
      cashExpenses,
      float?.closingCashCounted ?? null,
      cashMovedOut
    );
    const combined = combinedDifference(cashDifference, r.overTransferred, r.pendingTransfer);
    return {
      ...r,
      deliveryRevenue,
      salesTotal: round2(r.totalSales + deliveryRevenue),
      receivedTotal: round2(r.netReceived + deliveryRevenue),
      startingCash: float?.startingCash ?? null,
      cashMovedOut,
      closingCashCounted: float?.closingCashCounted ?? null,
      expectedCashBeforeMoveOut,
      cashDifference,
      combined,
    };
  });
}

export interface LedgerRangeTotals {
  salesTotal: number;
  receivedTotal: number;
  deliveryRevenue: number;
  expenses: number;
  transferred: number;
  pendingTransfer: number;
  overTransferred: number;
  /** Sum of every day's `combined` that's actually known (cash counted that day) — days still
   * `null` are left out entirely, never treated as 0, same philosophy as `combinedDifference`. */
  combined: number;
  /** How many of `rows` actually have a known `combined` (i.e. cash was counted that day) vs the
   * total day count — drives the "นับเงินสดแล้ว X จาก Y วัน" caveat in the summary line. */
  combinedKnownDays: number;
  totalDays: number;
}

export function ledgerRangeTotals(rows: readonly LedgerDayRow[]): LedgerRangeTotals {
  const known = rows.filter((r) => r.combined != null);
  const sums = rows.reduce(
    (acc, r) => ({
      salesTotal: round2(acc.salesTotal + r.salesTotal),
      receivedTotal: round2(acc.receivedTotal + r.receivedTotal),
      deliveryRevenue: round2(acc.deliveryRevenue + r.deliveryRevenue),
      expenses: round2(acc.expenses + r.expenses),
      transferred: round2(acc.transferred + r.transferred),
      pendingTransfer: round2(acc.pendingTransfer + r.pendingTransfer),
      overTransferred: round2(acc.overTransferred + r.overTransferred),
    }),
    { salesTotal: 0, receivedTotal: 0, deliveryRevenue: 0, expenses: 0, transferred: 0, pendingTransfer: 0, overTransferred: 0 }
  );
  return {
    ...sums,
    combined: round2(known.reduce((sum, r) => sum + (r.combined ?? 0), 0)),
    combinedKnownDays: known.length,
    totalDays: rows.length,
  };
}
