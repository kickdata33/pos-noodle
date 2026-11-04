import type { EpochMillis, WithId } from "./common";

/**
 * On-hand count for one product the shop sells by the piece (drinking water, snacks, bottled
 * drinks) — item: "อยากได้หน้าเช็คสต๊อก". Doc id = the product's id, so "is this product tracked"
 * is a single `get`, and a product can never have two stock rows. Products without a doc here are
 * simply not stock-tracked (noodle bowls are made to order, not counted).
 *
 * Every change to `qty` goes through a transaction that also writes a `StockMovement`, and sales
 * and deliveries are applied as differences against the current value — never a blind overwrite,
 * so a sale landing while someone is receiving stock can't be lost (same lesson as the G2 stock
 * fix). Only a physical count sets `qty` to an absolute number, and it records the difference.
 */
export interface StockLevel extends WithId {
  shopId: string;
  productId: string;
  /** Snapshot of the product name, refreshed by Admin edits — for Telegram messages composed
   * server-side and for history rows of products that were later deleted. */
  productName: string;
  /** Can go negative (sold more than the system thought was there) — that's information for the
   * next count, not something to block a sale over. */
  qty: number;
  /** At or below this, the item shows as "ใกล้หมด" and Telegram gets an alert when a sale crosses it. */
  lowThreshold: number;
  updatedAt: EpochMillis;
}

/** `void` = put back on the shelf because a paid bill was cancelled (Admin → รายการบิล). */
export type StockMovementType = "sale" | "receive" | "count" | "void";

/** One change to a `StockLevel`, append-only — the history/difference log. */
export interface StockMovement extends WithId {
  shopId: string;
  productId: string;
  productName: string;
  type: StockMovementType;
  /** Signed change applied to `qty`. For a count: counted − expected (0 when it matched). */
  delta: number;
  qtyBefore: number;
  qtyAfter: number;
  /** The paid order a sale came from. */
  orderId: string | null;
  /** Groups every line of one closing count, for its Telegram summary. */
  countId: string | null;
  note: string;
  createdBy: string;
  createdByName: string;
  createdAt: EpochMillis;
}
