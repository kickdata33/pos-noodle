/**
 * Pure math behind "ยอดเริ่มต้นประจำวัน" (the เงินสดเริ่มต้น/นับเงินสดปลายกะ/เงินสดที่โยกออกเก็บ fields
 * inside `/admin/accounting`'s per-day ledger row) — backs both that row's "ผลต่างเงินสด" figure and
 * the "ส่วนต่างรวม (เงินสด+โอน)" column (item: "ยอดเงินเกิน/ขาด ของทั้งเงินสดและเงินโอน ให้เอามา +- กันหา
 * ส่วนต่างที่ขาด/เกินจริง"). No Firestore, no `Date.now()`, same split as the rest of `lib/pos`,
 * unit-tested directly (`scripts/dailyFloat.test.ts`).
 *
 * `closingCashCounted` means the physical count taken AFTER cash was moved out to the safe — not
 * before. Earlier this asked for the pre-move-out count instead, which is backwards from how the
 * shop actually works the till (cash gets set aside *first*, then whatever is left gets counted),
 * and caused a real production mistake: the owner typed the post-move-out count into a field that
 * expected the pre-move-out one, double-subtracting `cashMovedOut` and reading as a ฿1,945
 * shortage that was never real. Flipping which number this field wants removes the mental "add
 * cashMovedOut back before typing" step entirely — `cashMovedOut` is added back here, in code,
 * every time this is computed, from whatever its current value is, rather than once at save time —
 * so correcting a mistyped `cashMovedOut` later never leaves a stale, silently-wrong comparison
 * sitting behind an already-saved count.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface CashFloatCheck {
  /** เงินสดที่ควรมี (ก่อนโยกออก) — startingCash + cashSales - cashExpenses. `null` when
   * `startingCash` was never entered for the day (nothing to check against yet). */
  expectedCashBeforeMoveOut: number | null;
  /** The pre-move-out equivalent of whatever was actually counted — closingCashCounted (the
   * post-move-out physical count) + cashMovedOut added back — so it's directly comparable to
   * `expectedCashBeforeMoveOut` above. `null` when `closingCashCounted` hasn't been entered yet. */
  countedBeforeMoveOut: number | null;
  /** ผลต่างเงินสด (countedBeforeMoveOut - ที่ควรมี) — positive is เงินเกิน, negative is เงินขาด. `null`
   * when either side of the comparison is itself `null` — there's nothing meaningful to diff
   * against yet, same as the row's own display rule. */
  cashDifference: number | null;
}

/**
 * `startingCash`/`closingCashCounted` are already-parsed numbers (or `null` for "not entered yet"
 * — see `DailyFloat`'s own field comments for why missing is never treated as zero); `cashSales`,
 * `cashExpenses` and `cashMovedOut` are always real numbers (0 when there simply weren't any).
 */
export function checkCashFloat(
  startingCash: number | null,
  cashSales: number,
  cashExpenses: number,
  closingCashCounted: number | null,
  cashMovedOut: number
): CashFloatCheck {
  const expectedCashBeforeMoveOut = startingCash != null ? round2(startingCash + cashSales - cashExpenses) : null;
  const countedBeforeMoveOut = closingCashCounted != null ? round2(closingCashCounted + cashMovedOut) : null;
  const cashDifference =
    countedBeforeMoveOut != null && expectedCashBeforeMoveOut != null ? round2(countedBeforeMoveOut - expectedCashBeforeMoveOut) : null;
  return { expectedCashBeforeMoveOut, countedBeforeMoveOut, cashDifference };
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
