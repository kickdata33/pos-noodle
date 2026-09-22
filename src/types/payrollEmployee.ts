import type { EpochMillis, WithId } from "./common";

/**
 * One shop staff member enrolled in the weekly payroll ledger (item: "สร้างตารางพนักงานแยก เพราะ
 * จะตัดจ่ายทุกอาทิตย์"). Doc id === the underlying `AppUser.id` (staffId) — one-to-one,
 * deterministic, so enrolling a staff member or looking them up never needs its own query. Not
 * every `AppUser` needs one of these; only staff actually paid a daily wage through this system
 * (an owner/admin who doesn't draw a wage this way is simply never enrolled).
 */
export interface PayrollEmployee extends WithId {
  shopId: string;
  staffId: string;
  staffName: string;
  /** Baht per day worked — the user confirmed wage is "คิดตามจำนวนวัน" (per day worked), not a
   * flat weekly amount. See `lib/pos/payroll.ts` for how a period's accrued wage is derived from
   * this and the days NOT marked as a `PayrollAbsence`. */
  dailyWage: number;
  /** Pause without losing history (a staff member who left, or is on long leave) — mirrors
   * `RecurringExpense.active`. An inactive employee stops accruing new wage but keeps every past
   * advance/settlement exactly as it is. */
  active: boolean;
  /** "YYYY-MM-DD" — the first day this employee starts accruing wage, and (before their first
   * `PayrollSettlement` exists) the start of their very first pay period. */
  createdDateKey: string;
  createdAt: EpochMillis;
  updatedAt: EpochMillis;
}
