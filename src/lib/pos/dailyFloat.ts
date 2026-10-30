/**
 * Pure math behind "ยอดเริ่มต้นประจำวัน" (the เงินสดเริ่มต้น/เงินสดรวมปลายกะ/เงินสดที่โยกออกเก็บ card
 * inside `/admin/accounting`'s day-detail dialog) — extracted out of `DailyFloatSection` so the
 * exact same formula backs both that dialog's "ผลต่างเงินสด" figure and the main reconciliation
 * table's combined over/short column (item: "ยอดเงินเกิน/ขาด ของทั้งเงินสดและเงินโอน ให้เอามา +- กันหา
 * ส่วนต่างที่ขาด/เกินจริง"). No Firestore, no `Date.now()`, same split as the rest of `lib/pos`,
 * unit-tested directly (`scripts/dailyFloat.test.ts`).
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface CashFloatCheck {
  /** เงินสดที่ควรมี (ก่อนโยกออก) — startingCash + cashSales - cashExpenses. `null` when
   * `startingCash` was never entered for the day (nothing to check against yet). */
  expectedCashBeforeMoveOut: number | null;
  /** ผลต่างเงินสด (รวมปลายกะ - ที่ควรมี) — positive is เงินเกิน, negative is เงินขาด. `null` when
   * either `closingCash` hasn't been counted yet or `expectedCashBeforeMoveOut` is itself `null`
   * — there's nothing meaningful to diff against yet, same as the dialog's own display rule. */
  cashDifference: number | null;
}

/**
 * `startingCash`/`closingCash` are already-parsed numbers (or `null` for "not entered yet" — see
 * `DailyFloat`'s own field comments for why missing is never treated as zero); `cashSales` and
 * `cashExpenses` are always real numbers (0 when there simply weren't any).
 */
export function checkCashFloat(
  startingCash: number | null,
  cashSales: number,
  cashExpenses: number,
  closingCash: number | null
): CashFloatCheck {
  const expectedCashBeforeMoveOut = startingCash != null ? round2(startingCash + cashSales - cashExpenses) : null;
  const cashDifference =
    closingCash != null && expectedCashBeforeMoveOut != null ? round2(closingCash - expectedCashBeforeMoveOut) : null;
  return { expectedCashBeforeMoveOut, cashDifference };
}

/**
 * ส่วนต่างรวมจริง (เงินสด+โอน) — nets the cash-drawer over/short against the bank-transfer
 * over/short so a day (or a whole range, by summing each day's result) reads as one real
 * discrepancy instead of two separate numbers that might even be hiding each other (a cash
 * shortage and a transfer overage of the same size looking, apart, like two unrelated small
 * issues instead of one bill rung in under the wrong payment method). `null`, not 0, when the
 * cash side was never counted for that day — a missing physical count means "we don't know",
 * never "assume it's fine", so it's never silently folded in as if it were a confirmed zero.
 */
export function combinedDifference(cashDifferenceAmount: number | null, overTransferred: number, pendingTransfer: number): number | null {
  if (cashDifferenceAmount == null) return null;
  return round2(cashDifferenceAmount + overTransferred - pendingTransfer);
}
