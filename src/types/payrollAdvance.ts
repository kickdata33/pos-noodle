import type { EpochMillis, WithId } from "./common";

/**
 * One cash advance (เบิกเงินล่วงหน้า) against a `PayrollEmployee`'s currently accruing, not-yet-
 * settled wage — the user's own rule: "เบิกได้ไม่เกินยอดที่ค้างจ่าย". Validated at write time (see
 * `computeAvailableAdvance` in `lib/pos/payroll.ts`) so a staff member can never be advanced more
 * than what they've actually earned so far this pay period.
 */
export interface PayrollAdvance extends WithId {
  shopId: string;
  staffId: string;
  staffName: string;
  amount: number;
  /** "YYYY-MM-DD" — the day the advance was taken (defaults to today, but adjustable — an
   * advance can happen any day within the current, still-open pay period). */
  dateKey: string;
  note: string;
  createdBy: string;
  createdByName: string;
  createdAt: EpochMillis;
}
