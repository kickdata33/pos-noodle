import type { CashSafeCount, DailyFloat } from "@/types";

/**
 * Pure math behind "ตารางตัดเงินสดออก" (item: cash physically pulled from the drawer mid-shift
 * and kept aside, see `DailyFloat.cashMovedOut`'s comment) — no Firestore, no `Date.now()`, same
 * split as the rest of `lib/pos`, unit-tested directly (`scripts/cashMoveOut.test.ts`).
 *
 * Confirmed design (from discussion with the shop owner):
 * - "รวมที่ควรจะมี" is a running cumulative total across the shop's *entire* history, never reset
 *   per month — a month is only how the table groups rows for display.
 * - "ตอนนี้มีเท่าไหร่" is a separate, manually-entered figure (`CashSafeCount`), not derived from
 *   `cashMovedOut` at all — someone actually counted the stash.
 */

export interface CashMoveOutRow {
  dateKey: string;
  /** เงินสดที่โยกออกเก็บวันนั้น — this one business day's `DailyFloat.cashMovedOut`. */
  movedOut: number;
  /** สะสมถึงวันนี้ — running total of every `movedOut` from the very first entry through this
   * row, in calendar order. Never resets at a month boundary; `rowsForMonth` only *filters* which
   * rows are shown, it doesn't restart this running total. */
  cumulative: number;
}

/**
 * One row per business day that has a `cashMovedOut` entry (skips days that were never filled
 * in — no `DailyFloat` doc, or the field is still `null` — same "missing means not entered yet,
 * not zero" rule the type itself documents), in ascending date order with a running cumulative
 * total. This is the one place the cumulative is computed; every other function here takes the
 * result of this one rather than re-deriving it, so a month view's cumulative always agrees with
 * the all-time total.
 */
export function cashMoveOutRows(floats: readonly DailyFloat[]): CashMoveOutRow[] {
  const entered = floats
    .filter((f) => f.cashMovedOut != null)
    .map((f) => ({ dateKey: f.businessDayKey, movedOut: f.cashMovedOut as number }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  let running = 0;
  return entered.map((row) => {
    running += row.movedOut;
    return { ...row, cumulative: running };
  });
}

/** "รวมที่ควรจะมี" — the all-time cumulative total, i.e. the last row's `cumulative` (0 if
 * nothing has ever been entered). Takes the already-computed rows rather than raw `DailyFloat[]`
 * so a caller that already has `cashMoveOutRows` doesn't redo the sum. */
export function totalMovedOut(rows: readonly CashMoveOutRow[]): number {
  return rows.length > 0 ? rows[rows.length - 1].cumulative : 0;
}

/** Rows whose `dateKey` falls in `monthKey` ("YYYY-MM") — the cumulative on each row still
 * reflects the all-time running total, not a total restarted for the month (see the file
 * comment's confirmed design). */
export function rowsForMonth(rows: readonly CashMoveOutRow[], monthKey: string): CashMoveOutRow[] {
  return rows.filter((r) => r.dateKey.startsWith(monthKey));
}

/** Every distinct "YYYY-MM" that has at least one entered row, most recent first — feeds the
 * month picker's "jump to a month that actually has data" affordance. */
export function availableMonths(rows: readonly CashMoveOutRow[]): string[] {
  const months = new Set(rows.map((r) => r.dateKey.slice(0, 7)));
  return [...months].sort().reverse();
}

/** The single most recent `CashSafeCount` (by `dateKey`, ties broken by `createdAt`) — this is
 * "ตอนนี้มีเท่าไหร่" on the summary card. `null` if nobody has ever recorded a count. */
export function latestCashSafeCount(counts: readonly CashSafeCount[]): CashSafeCount | null {
  if (counts.length === 0) return null;
  return [...counts].sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.createdAt - a.createdAt)[0];
}
