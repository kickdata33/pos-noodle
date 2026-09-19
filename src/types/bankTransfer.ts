import type { EpochMillis, WithId } from "./common";

/**
 * One manually-logged bank deposit from a payment provider's settlement batch (K SHOP, or any
 * other provider the shop uses later) — entered by hand from the bank's own app/statement, since
 * this codebase has no bank API integration to pull it automatically (same limitation noted on
 * the billing side for Omise). `transferredAt` is the real moment the money landed in the bank
 * account (e.g. "23:00 18 ก.ย."), which is what the reconciliation table in `lib/pos/reconciliation.ts`
 * matches against each business day's actual time span — not the calendar date alone, since a
 * business day can receive two separate transfers on two different calendar dates (see that
 * file's comment for the full mechanics).
 */
export interface BankTransfer extends WithId {
  shopId: string;
  transferredAt: EpochMillis;
  amount: number;
  /**
   * Which business-day row (the same "YYYY-MM-DD" label `lib/pos/reconciliation.ts`'s
   * `businessDaySales` produces) this transfer settles — set by the person entering it, not
   * inferred from `transferredAt`. A time-window guess would get this wrong: K SHOP's fixed
   * 23:00 cutoff and the shop's own 16:00-start business day don't line up, so one business
   * day's late-night (post-23:00) sales settle at 23:00 the *next* calendar night, landing well
   * inside what a naive time-window check would call the *following* business day. A human who
   * knows which night's sales a given bank line actually covers gets this right far more
   * reliably than a formula guessing from the clock alone.
   */
  businessDayKey: string;
  /** Optional free-text, e.g. "K SHOP" or "รอบ 23:00" — purely a human label, never parsed. */
  note: string;
  createdBy: string;
  createdByName: string;
  createdAt: EpochMillis;
}
