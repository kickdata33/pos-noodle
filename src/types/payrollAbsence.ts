import type { EpochMillis, WithId } from "./common";

/**
 * Marks one specific day as "this employee did not work — don't accrue wage for it" (the user's
 * own rule: "ถือว่ามาทุกวัน เว้นแต่มาร์กลา"). Same default-on/explicit-exception shape as
 * `RecurringExpenseSkip` — every day accrues wage unless it has a matching absence here, so
 * marking someone absent is the only action needed; nothing has to be marked "present".
 * Deterministic id `${staffId}_${dateKey}`, same construction as `RecurringExpenseSkip`'s.
 */
export interface PayrollAbsence extends WithId {
  shopId: string;
  staffId: string;
  dateKey: string;
  createdAt: EpochMillis;
}
