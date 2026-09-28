import type { EpochMillis, WithId } from "./common";

/**
 * One manual "we physically counted the cash-moved-out safe/bank stash and it has this much in
 * it" checkpoint (item: "ตารางตัดเงินสดออก ... ตอนนี้มีเท่าไหร่"). Separate from `DailyFloat`'s
 * `cashMovedOut` — that's what the shop *expects* to have accumulated (the sum of every day's
 * "เงินสดที่โยกออกเก็บ", see `lib/pos/cashMoveOut.ts`'s `totalMovedOut`); this is what a person
 * actually counted, entered whenever the owner checks the stash, not once per business day. The
 * most recent entry (by `dateKey`, ties broken by `createdAt`) is "ตอนนี้มีเท่าไหร่" on
 * `/admin/cash-safe`; older entries stay as a history log, same "log of manual snapshots" shape
 * as `DeliveryPayout`.
 */
export interface CashSafeCount extends WithId {
  shopId: string;
  dateKey: string;
  amount: number;
  /** Free-text, e.g. "นับพร้อมยอดเดือน" or "เอาไปฝากธนาคารบางส่วนแล้ว" — purely a human label,
   * never parsed, same role as `DeliveryPayout.note`. */
  note: string;
  createdBy: string;
  createdByName: string;
  createdAt: EpochMillis;
}
