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
   * re-derived here) to show "เงินสดที่ควรมีปลายกะ" = startingCash + cashSales — the number to
   * check a physical count against at closing, not something this app counts itself.
   */
  startingCash: number | null;
  /**
   * ยอดคงเหลือในแอป K SHOP ตอนเริ่มกะ (~16:00) — K SHOP's own wallet-balance display is
   * cumulative (it keeps whatever hasn't been swept to the bank yet), so a same-day reading
   * later in the shift is meaningless on its own (item: "ในระบบขึ้น 690 มันเป็นของเมื่อคืนล้นมา" —
   * that 690 was left over from the *previous* shift, not today's sales). Subtracted from
   * `kshopCheckedBalance` to get the QR total actually made *this* shift.
   */
  startingKshopBalance: number | null;
  /** The K SHOP app's wallet-balance reading at the moment it was last checked mid/end-of-shift
   * (e.g. at 23:00) — `kshopCheckedBalance - startingKshopBalance` is that shift's real QR total
   * as of the check, independent of `reconciliationRows`' own QR figure (which comes from this
   * POS's own order records, not the K SHOP app) — a useful second, independent check. */
  kshopCheckedBalance: number | null;
  kshopCheckedAt: EpochMillis | null;
  /**
   * เงินสดที่นับได้จริงตอนปิดกะ — the physical count from the drawer, entered once at close.
   * Compared against `startingCash + cashSales` ("เงินสดที่ควรมีปลายกะ", computed in
   * `DailyFloatSection`, never stored) the same way `kshopCheckedBalance` is compared against the
   * POS's own QR figure: a second, independent number to catch a shortage/overage, not something
   * this app derives or corrects on its own.
   */
  closingCashCounted: number | null;
  closingCashCountedAt: EpochMillis | null;
  updatedBy: string;
  updatedByName: string;
  updatedAt: EpochMillis;
}
