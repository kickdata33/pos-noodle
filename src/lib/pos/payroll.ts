import { addDaysToKey, dateKeysBetween } from "./dateRange";

/**
 * Weekly payroll math (item: "สร้างตารางพนักงานแยก เพราะจะตัดจ่ายทุกอาทิตย์"). Every function here
 * is pure and only ever sees plain "YYYY-MM-DD" date keys / numbers — no Firestore, no `Date.now()`
 * — so it's unit-tested directly (`scripts/payroll.test.ts`), same split as `recurringExpenses.ts`.
 *
 * Confirmed design (from discussion with the shop owner):
 * - Wage accrues per day worked ("คิดตามจำนวนวัน"), at that employee's own `dailyWage`.
 * - Every day counts as worked *unless* explicitly marked absent ("ถือว่ามาทุกวัน เว้นแต่มาร์กลา") —
 *   same default-on/explicit-exception shape as `recurringExpenses.ts`'s skip pattern.
 * - An advance (เบิก) can never exceed what's already been earned and not yet advanced
 *   ("เบิกได้ไม่เกินยอดที่ค้างจ่าย") — `computeAvailableAdvance` is what the UI checks before
 *   allowing one to be saved.
 * - Payday is every Monday, but "ตัดจ่าย" itself can happen whenever an Admin actually gets to
 *   it — the period just keeps accruing until they do.
 */

/**
 * The first day of an employee's *current*, still-open pay period: the day after their most
 * recent settlement's `periodEnd`, or (before they've ever been settled) the day they were
 * enrolled. Passing `null` for `lastSettlementPeriodEnd` is what "never settled yet" looks like.
 */
export function computeCurrentPeriodStart(employeeCreatedDateKey: string, lastSettlementPeriodEnd: string | null): string {
  return lastSettlementPeriodEnd ? addDaysToKey(lastSettlementPeriodEnd, 1) : employeeCreatedDateKey;
}

export interface AccrualResult {
  daysWorked: number;
  accruedWage: number;
}

/**
 * How much wage has accrued from `periodStart` through `periodEnd`, inclusive, at `dailyWage`
 * per day — every day in the range counts unless it's in `absentDateKeys`. Returns zero for an
 * empty/inverted range (e.g. a brand new employee whose period hasn't started yet) rather than
 * throwing, since the accounting page needs to render *something* for a period-of-zero-days.
 */
export function computeAccrual(
  periodStart: string,
  periodEnd: string,
  dailyWage: number,
  absentDateKeys: ReadonlySet<string>
): AccrualResult {
  if (periodStart > periodEnd) return { daysWorked: 0, accruedWage: 0 };
  const daysWorked = dateKeysBetween(periodStart, periodEnd).filter((k) => !absentDateKeys.has(k)).length;
  return { daysWorked, accruedWage: daysWorked * dailyWage };
}

/**
 * How much more can be advanced right now — the shop owner's own rule, "เบิกได้ไม่เกินยอดที่
 * ค้างจ่าย". Floored at zero: `totalAdvances` should never legitimately exceed `accruedWage`
 * (the UI is what enforces that at write time), but this stays defensive rather than ever
 * suggesting a negative "available" amount.
 */
export function computeAvailableAdvance(accruedWage: number, totalAdvances: number): number {
  return Math.max(0, accruedWage - totalAdvances);
}

export interface SettlementPreview {
  daysWorked: number;
  accruedWage: number;
  totalAdvances: number;
  /** What's actually handed over on payday — `accruedWage - totalAdvances`. Not floored at zero:
   * if this ever comes out negative (shouldn't, given the advance cap above, but could from a
   * dailyWage lowered mid-period) it should read as a clear negative number, not be silently
   * hidden as zero. */
  netPaid: number;
}

/** The full "ตัดจ่าย" confirmation preview for one employee's current period. */
export function computeSettlementPreview(
  periodStart: string,
  periodEnd: string,
  dailyWage: number,
  absentDateKeys: ReadonlySet<string>,
  totalAdvances: number
): SettlementPreview {
  const { daysWorked, accruedWage } = computeAccrual(periodStart, periodEnd, dailyWage, absentDateKeys);
  return { daysWorked, accruedWage, totalAdvances, netPaid: accruedWage - totalAdvances };
}
