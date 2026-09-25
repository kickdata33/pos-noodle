import type { EpochMillis, WithId } from "./common";

/** Which delivery aggregator a payout came from — the shop's actual current lineup (item: ตาราง
 * ตัวอย่าง Grab/Line man/Shopee), plus "other" so a platform not in this fixed list (or a
 * one-off courier) still has somewhere to go rather than being forced into the wrong bucket.
 * Kept as a plain string union like `ExpenseCategory`, not a separate admin-editable collection —
 * this list changes about as rarely as the shop's actual delivery-app lineup does. */
export const DELIVERY_PLATFORMS = ["grab", "lineman", "shopeeFood", "other"] as const;
export type DeliveryPlatform = (typeof DELIVERY_PLATFORMS)[number];

export const DELIVERY_PLATFORM_LABELS: Record<DeliveryPlatform, string> = {
  grab: "Grab",
  lineman: "Line man",
  shopeeFood: "Shopee",
  other: "อื่นๆ",
};

/**
 * One manually-logged payout landing in the bank from a delivery aggregator (item: "ยอดขาย
 * delivery" — modeled on the shop's own tracking spreadsheet: Grab settles to one bank account,
 * Line man to another, each on its own schedule). Unlike `BankTransfer` (QR/K SHOP, matched to a
 * business-day *shift* because K SHOP's cutoff splits one shift across two calendar nights),
 * delivery aggregators pay out on their own periodic schedule that has no fixed relationship to
 * the shop's 16:00 shift start, so this is matched by plain calendar `dateKey` instead — the day
 * the payout was actually logged, same as `Expense`, not a shift label.
 */
export interface DeliveryPayout extends WithId {
  shopId: string;
  dateKey: string;
  platform: DeliveryPlatform;
  amount: number;
  /** Optional free-text, e.g. "KTB" or "รอบสัปดาห์ 16-22 ก.ย." — purely a human label, never
   * parsed, same role as `BankTransfer.note`. */
  note: string;
  createdBy: string;
  createdByName: string;
  createdAt: EpochMillis;
}
