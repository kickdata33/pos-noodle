import type { EpochMillis, WithId } from "./common";

/**
 * One logged "หยิบเงินออกจากที่เก็บไปใช้" event — money that was previously moved out of the
 * register and accumulated into the cash-safe stash (`DailyFloat.cashMovedOut`, summed by
 * `lib/pos/cashMoveOut.ts`'s `totalMovedOut`) and has now been physically taken back out to
 * spend on something. Without this, "รวมที่ควรจะมี" on `/admin/cash-safe` only ever grows, so
 * spending any of the stash permanently reads as an unexplained shortage once someone counts it
 * — `totalWithdrawn` (same file) is subtracted from that running total so the comparison against
 * a physical count stays meaningful. Kept as its own itemized log rather than folded into
 * `DailyFloat.cashMovedOut` (one overwritten number per day, representing money moving the other
 * direction) — same "log of discrete manual events" shape as `CashSafeCount`/`DeliveryPayout`.
 */
export interface CashSafeWithdrawal extends WithId {
  shopId: string;
  dateKey: string;
  amount: number;
  /** What it was taken out for, e.g. "จ่ายค่าของสด" or "เอาไปฝากธนาคาร" — free-text, never parsed,
   * same role as `CashSafeCount.note`. Not strictly required, but the UI nudges for it since the
   * whole point of logging a withdrawal (instead of just quietly accepting a lower count) is to
   * explain why "ควรมี" came down. */
  note: string;
  createdBy: string;
  createdByName: string;
  createdAt: EpochMillis;
}
