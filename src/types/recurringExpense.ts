import type { EpochMillis, WithId } from "./common";
import type { ExpenseCategory } from "./expense";

/**
 * A template for an expense that recurs every day (rent, staff wages, internet — item request:
 * "ต้องการให้รายจ่ายประจำ ขึ้นอัตโนมัติเลยหากวันไหนไม่มีจะออกเอง"). This doc itself never shows up
 * in the รายจ่าย list — it's just the recipe `/admin/accounting` reads to auto-create that day's
 * actual `Expense` row (see `computeMissingRecurringExpenses`), one per calendar day, linked back
 * via `Expense.recurringExpenseId`.
 *
 * `createdDateKey` (not just `createdAt`) is stored explicitly so generation can compare it
 * directly against plain "YYYY-MM-DD" `dateKey` strings without redoing timezone math every time
 * — a template can never generate a row for a day before it existed.
 */
export interface RecurringExpense extends WithId {
  shopId: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  paymentMethod: "cash" | "transfer";
  /** Pause without losing the template/history — an inactive template stops generating new rows
   * but every `Expense` it already created stays exactly as it is (item: seasonal costs that
   * stop for a while, e.g. a staff member on leave, without deleting the whole setup). */
  active: boolean;
  /** "YYYY-MM-DD", Bangkok calendar day — see the type comment above. */
  createdDateKey: string;
  createdAt: EpochMillis;
  updatedAt: EpochMillis;
}
