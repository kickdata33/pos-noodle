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
  /** salesTotal - expenses — the day's plain accounting profit/loss ("กำไร/ขาดทุน"), the table's
   * headline number (v2 redesign, item: "เอายอดขายแต่ละช่องมารวมกัน และเอาไป - กับ รายจ่าย เหลือสุทธิ
   * เท่าไหร่ กำไรเท่าไหร่ ขาดทุนเท่าไหร่ในวันนั้นๆ"). Deliberately independent of the cash-count check
   * below — a day can run a loss and still count cash exactly right, or vice versa; conflating the
   * two under one "ส่วนต่างรวม" figure was the source of the v1 confusion this redesign fixes. Unlike
   * `combined`, this is never `null` — it only needs POS-recorded sales and logged expenses, neither
   * of which requires a physical cash count to exist. */
  netProfit: number;
  /** The day's own `DailyFloat.startingCash`, or `null` if never explicitly entered for this exact
   * business day. Kept distinct from `effectiveStartingCash` below — this is "did the owner
   * actually confirm today's figure", not "what value do calculations use". */
  startingCash: number | null;
  /** `startingCash` if explicitly entered for this day, otherwise carried forward from the most
   * recent earlier business day's `closingCashCounted` (physical cash left in the drawer at close
   * is still sitting there at the next open, so re-typing the same number every single day was
   * pure friction). This is what the cash-float check actually calculates with, so "เงินสดคงเหลือ"
   * and "ส่วนต่างจากการนับ" don't go blank just because today hasn't been re-confirmed yet. `null`
   * only when there is truly no known figure to fall back on at all (e.g. the very first day). */
  effectiveStartingCash: number | null;
  /** True when `effectiveStartingCash` came from carry-forward rather than today's own entry — lets
   * the UI show it as a suggested default (still editable) instead of implying it was confirmed. */
  startingCashIsCarriedForward: boolean;
  cashMovedOut: number;
  /** ปลายกะที่นับได้จริง, AFTER cashMovedOut was already set aside — see `DailyFloat.closingCashCounted`'s comment. */
  closingCashCounted: number | null;
  expectedCashBeforeMoveOut: number | null;
  /** expectedCashBeforeMoveOut - cashMovedOut — how much cash *should* physically be in the drawer
   * right now, folding in today's cash sales/expenses and whatever's already been moved out to
   * storage ("เงินสดเริ่มต้น โยกออกเข้าเก็บ คงเหลือสุทธิ รวมกับยอดขายปัจจุบันด้วยสำหรับเงินสด"). This is the
   * calculated/expected figure, shown in the main row; it is NOT compared against the physical count
   * here — that comparison is `cashDifference`, a separate secondary check. `null` whenever
   * `expectedCashBeforeMoveOut` is (i.e. `startingCash` hasn't been entered yet). */
  cashRemainingNow: number | null;
  cashDifference: number | null;
  /** ส่วนต่างรวม (เงินสด+โอน) — `null` (not 0) until the day's cash has actually been counted. Secondary
   * reconciliation check only (catches a miscount or a staff member tapping the wrong payment
   * button) — not to be read as profit/loss; see `netProfit`. */
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

/** Walks `floats` for the most recent business day strictly before `dateKey` that actually has a
 * counted closing figure. `businessDayKey` is a plain "YYYY-MM-DD" string, which sorts
 * chronologically as-is, so this needs no date-arithmetic. Skips over any gap (a day with no float
 * doc at all, or one whose `closingCashCounted` is still null) rather than only ever looking
 * exactly one calendar day back, so a shop-closed day or a day nobody counted doesn't break the
 * chain for every day after it. */
function mostRecentClosingCashBefore(floats: readonly DailyFloat[], dateKey: string): number | null {
  let best: DailyFloat | null = null;
  for (const f of floats) {
    if (f.businessDayKey < dateKey && f.closingCashCounted != null && (!best || f.businessDayKey > best.businessDayKey)) {
      best = f;
    }
  }
  return best?.closingCashCounted ?? null;
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
    const carriedStartingCash = float?.startingCash == null ? mostRecentClosingCashBefore(floats, r.dateKey) : null;
    const effectiveStartingCash = float?.startingCash ?? carriedStartingCash;
    const { expectedCashBeforeMoveOut, cashDifference } = checkCashFloat(
      effectiveStartingCash,
      r.cashSales,
      cashExpenses,
      float?.closingCashCounted ?? null,
      cashMovedOut
    );
    const combined = combinedDifference(cashDifference, r.overTransferred, r.pendingTransfer);
    const salesTotal = round2(r.totalSales + deliveryRevenue);
    const cashRemainingNow = expectedCashBeforeMoveOut != null ? round2(expectedCashBeforeMoveOut - cashMovedOut) : null;
    return {
      ...r,
      deliveryRevenue,
      salesTotal,
      receivedTotal: round2(r.netReceived + deliveryRevenue),
      netProfit: round2(salesTotal - r.expenses),
      startingCash: float?.startingCash ?? null,
      effectiveStartingCash,
      startingCashIsCarriedForward: float?.startingCash == null && carriedStartingCash != null,
      cashMovedOut,
      closingCashCounted: float?.closingCashCounted ?? null,
      expectedCashBeforeMoveOut,
      cashRemainingNow,
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
  /** Sum of every day's `netProfit` — the range's headline กำไร/ขาดทุน. Always a plain sum (never
   * excludes a day), since `netProfit` is never `null`. */
  netProfit: number;
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
      netProfit: round2(acc.netProfit + r.netProfit),
    }),
    { salesTotal: 0, receivedTotal: 0, deliveryRevenue: 0, expenses: 0, transferred: 0, pendingTransfer: 0, overTransferred: 0, netProfit: 0 }
  );
  return {
    ...sums,
    combined: round2(known.reduce((sum, r) => sum + (r.combined ?? 0), 0)),
    combinedKnownDays: known.length,
    totalDays: rows.length,
  };
}
