import type { EpochMillis, WithId } from "./common";

/**
 * Marks one specific day as "don't auto-create this recurring expense" (item: "ถ้าวันไหนหยุด
 * เดี๋ยวลบออกเอง" — a shop closed that day, or a staff member off, shouldn't get that day's usual
 * rent/wage row). Written the moment staff deletes an auto-generated `Expense` row (see
 * `ExpenseRow`'s delete handler) rather than left implicit, because "no `Expense` doc for this
 * template+day" is otherwise indistinguishable from "hasn't been generated yet" — without this,
 * the very next time `/admin/accounting` loads it would just recreate the row staff just deleted.
 *
 * Id is deterministic (`${recurringExpenseId}_${dateKey}`) so writing it is naturally idempotent
 * and a lookup never needs its own query — same id-construction pattern as `DailyFloat`'s
 * `${shopId}_${businessDayKey}`.
 */
export interface RecurringExpenseSkip extends WithId {
  shopId: string;
  recurringExpenseId: string;
  dateKey: string;
  createdAt: EpochMillis;
}
