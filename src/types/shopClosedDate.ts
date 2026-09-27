import type { EpochMillis, WithId } from "./common";

/**
 * One override to the shop's recurring "closed on these days of the month" rule
 * (`ShopSettings.closedDaysOfMonth`, default `[1, 16]` — the shop's usual rest days). Two shapes,
 * told apart by `closed`:
 *
 * - `closed: true` — an extra one-off closure on a day that wouldn't otherwise be closed (e.g. a
 *   public holiday, or the shop just decided to take an unplanned day off).
 * - `closed: false` — the shop stayed open on a day that would normally be closed by the
 *   recurring rule (e.g. it fell on the 1st or 16th but the owner chose to open anyway that
 *   month).
 *
 * Either way this is a per-date exception, resolved by `isShopClosedDay` (`lib/pos/shopCalendar.ts`)
 * ahead of the recurring day-of-month rule — an override for a given `dateKey` always wins over
 * whatever the recurring rule alone would have said. Feeds directly into payroll accrual
 * (`computeAccrual` in `lib/pos/payroll.ts`): a closed day never counts as a paid day worked, for
 * every enrolled employee at once, without anyone having to mark each person "ลา" individually.
 *
 * Id is deterministic (`${shopId}_${dateKey}`), same construction as `DailyFloat`'s
 * `${shopId}_${businessDayKey}` — one override per shop per calendar day, so writing it is
 * naturally idempotent and a lookup never needs its own query.
 */
export interface ShopClosedDate extends WithId {
  shopId: string;
  dateKey: string;
  closed: boolean;
  /** Free-text reason, e.g. "วันสงกรานต์" or "เปิดตามปกติ ไม่หยุด" — purely a human label, never
   * parsed, same role as `Expense.description`. */
  note: string;
  createdBy: string;
  createdByName: string;
  createdAt: EpochMillis;
}
