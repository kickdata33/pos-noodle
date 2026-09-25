import type { EpochMillis, WithId } from "./common";

/**
 * One cash top-up added to the till specifically to make change for delivery riders on
 * cash-on-delivery orders (item: "เงินทุน/ทอนที่เติมเข้าลิ้นชักสำหรับส่ง delivery" — the shop's own
 * spreadsheet's "เงินสด" column). This is money the owner puts in from outside the day's sales,
 * not sales revenue itself, so it's tracked as its own running log rather than folding into
 * `DailyFloat.startingCash` (that field is the dine-in drawer's change float for the shop's own
 * 16:00–04:00 shift; this one is a separate, longer-lived reserve that gets topped up
 * irregularly, not reset every business day). Only additions are logged here — same "one number,
 * entered once" shape as a bank transfer or expense row; there's no separate "used" entry because
 * the shop doesn't track individual disbursements from this reserve, only how much has gone in.
 */
export interface DeliveryFloatTopUp extends WithId {
  shopId: string;
  dateKey: string;
  amount: number;
  note: string;
  createdBy: string;
  createdByName: string;
  createdAt: EpochMillis;
}
