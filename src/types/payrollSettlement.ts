import type { EpochMillis, WithId } from "./common";

/**
 * One completed "ตัดจ่าย" — a snapshot of a closed pay period for one employee, written the
 * moment an Admin confirms payment. `periodEnd` is what the *next* period's `periodStart`
 * derives from (`computeCurrentPeriodStart` in `lib/pos/payroll.ts` looks up the most recent
 * settlement per employee and starts the new period the day after it) — so writing this doc is
 * also what "resets the clock" for the following week. Every field here is a snapshot at
 * settlement time (like `Subscription.priceThb`'s reasoning) so a later change to
 * `PayrollEmployee.dailyWage` never rewrites what a past pay period actually paid out.
 */
export interface PayrollSettlement extends WithId {
  shopId: string;
  staffId: string;
  staffName: string;
  /** "YYYY-MM-DD", inclusive on both ends. */
  periodStart: string;
  periodEnd: string;
  dailyWage: number;
  daysWorked: number;
  accruedWage: number;
  totalAdvances: number;
  netPaid: number;
  paidAt: EpochMillis;
  paidBy: string;
  paidByName: string;
}
