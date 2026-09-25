import type { EpochMillis, WithId } from "./common";

/**
 * One doc per shop per business day (id `${shopId}_${businessDayKey}`) — the "starting" numbers
 * needed to turn a raw balance/QR reading into an actual sales figure. Neither field is derived
 * from `orders`/`bankTransfers` — both are numbers only a person standing at the register or
 * looking at the K SHOP app actually knows, entered by hand the same way `Expense`/`BankTransfer`
 * are. `null` (not 0) means "not entered yet for this day" — 0 is a real starting balance too, so
 * every read must tell the two apart rather than treating a missing value as zero.
 */
export interface DailyFloat extends WithId {
  shopId: string;
  businessDayKey: string;
  /**
   * เงินสดเริ่มต้น (ทอน) — the change float placed in the drawer before the shift opens. Combined
   * with that business day's own `cashSales` (already computed by `reconciliationRows`, never
   * re-derived here) and `cashMovedOut` to show "เงินสดที่ควรมีปลายกะ" =
   * startingCash + cashSales - cashMovedOut — the number to check a physical count against at
   * closing, not something this app counts itself.
   */
  startingCash: number | null;
  /**
   * เงินสดที่โยกออกระหว่างกะ (item: "ยอดเงินสดโยกออก") — cash physically pulled from the drawer
   * mid-shift for something other than a logged `Expense` (most commonly: taken to the bank, or
   * moved to a safe) — money that's genuinely gone from the till without being a cost of running
   * the shop, so it doesn't belong in `รายจ่าย`. Subtracted from "เงินสดที่ควรมีปลายกะ" so a
   * legitimate cash pull doesn't read as a shortage when counted at close. A single running total
   * for the day, not itemized — same "one number, entered once" shape as `startingCash`.
   */
  cashMovedOut: number | null;
  /**
   * ยอดปรับ (สลับเงินสด/โอน) — item: "กดผิด ยอดเงินโอนเกินบ้าง ยอดเงินสดเกินบ้าง ขาดโอน เกินสด
   * ขาดสด เกินโอน". A single signed correction per business day for a bill rung in under the
   * wrong payment method — positive moves that amount from `cashSales` into `qrSales` (rung in as
   * cash, actually a transfer), negative the other way. Consumed by `reconciliationRows`
   * (`lib/pos/reconciliation.ts`, see its own comment), never by anything in this type directly —
   * it's stored here only because it's a once-a-day, hand-entered number with nowhere else to
   * live, same as every other field on this doc.
   */
  cashTransferAdjustment: number | null;
  /**
   * เงินสดที่นับได้จริงตอนปิดกะ — the physical count from the drawer, entered once at close.
   * Compared against "เงินสดที่ควรมีปลายกะ" (startingCash + cashSales - cashMovedOut, computed in
   * `DailyFloatSection`, never stored) — a second, independent number to catch a shortage/overage,
   * not something this app derives or corrects on its own.
   */
  closingCashCounted: number | null;
  closingCashCountedAt: EpochMillis | null;
  updatedBy: string;
  updatedByName: string;
  updatedAt: EpochMillis;
}
