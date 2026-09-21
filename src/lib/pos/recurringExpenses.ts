import type { ExpenseCategory } from "@/types";

/** Just the fields `computeMissingRecurringExpenses` actually needs from a `RecurringExpense` —
 * kept narrow so this stays pure/easy to unit test without dragging in the full Firestore type. */
export interface RecurringExpenseTemplateForGen {
  id: string;
  shopId: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  paymentMethod: "cash" | "transfer";
  active: boolean;
  /** "YYYY-MM-DD" — see `RecurringExpense.createdDateKey`'s comment. */
  createdDateKey: string;
}

export interface GeneratedExpense {
  shopId: string;
  dateKey: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  paymentMethod: "cash" | "transfer";
  recurringExpenseId: string;
}

/** Builds the `${recurringExpenseId}:${dateKey}` key used by both `existingKeys` and
 * `skippedKeys` below — exported so callers derive it the same way instead of re-inventing the
 * separator. */
export function recurringExpenseDayKey(recurringExpenseId: string, dateKey: string): string {
  return `${recurringExpenseId}:${dateKey}`;
}

/**
 * For every active recurring-expense template and every day in `dateKeys`, decides whether that
 * (template, day) pair still needs an `Expense` row created for it — and if so, returns exactly
 * the payload to create (item: "ต้องการให้รายจ่ายประจำ ขึ้นอัตโนมัติเลยหากวันไหนไม่มีจะออกเอง").
 *
 * A pair is skipped when: the template is inactive, the day is before the template even existed
 * (`createdDateKey`), a real `Expense` already exists for that pair (`existingKeys` — whether
 * auto-generated earlier or someone happened to type the exact same thing by hand), or staff
 * explicitly deleted that day's row before (`skippedKeys` — see `RecurringExpenseSkip`'s
 * comment, item: "ถ้าวันไหนหยุด เดี๋ยวลบออกเอง").
 *
 * Pure and order-independent — `dateKeys` doesn't need to be sorted, and calling this twice with
 * an overlapping `dateKeys` window (e.g. every time the accounting page mounts) is always safe:
 * once a day's row exists, `existingKeys` covers it and nothing is generated twice.
 */
export function computeMissingRecurringExpenses(
  templates: RecurringExpenseTemplateForGen[],
  existingKeys: ReadonlySet<string>,
  skippedKeys: ReadonlySet<string>,
  dateKeys: string[]
): GeneratedExpense[] {
  const missing: GeneratedExpense[] = [];
  for (const template of templates) {
    if (!template.active) continue;
    for (const dateKey of dateKeys) {
      if (dateKey < template.createdDateKey) continue;
      const key = recurringExpenseDayKey(template.id, dateKey);
      if (existingKeys.has(key) || skippedKeys.has(key)) continue;
      missing.push({
        shopId: template.shopId,
        dateKey,
        category: template.category,
        description: template.description,
        amount: template.amount,
        paymentMethod: template.paymentMethod,
        recurringExpenseId: template.id,
      });
    }
  }
  return missing;
}
