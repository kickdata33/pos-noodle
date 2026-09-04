import type { EpochMillis, WithId } from "./common";

/**
 * Sales channel, fully Admin-managed and DB-backed (item 14) — "Grab" / "LINE MAN" /
 * "ShopeeFood" must never be hardcoded into a component, only ever read from this collection.
 * `code` is a stable machine key seeded for the default channels (used by the future delivery
 * API integration layer per item 30); Admin-created custom channels can leave it null.
 */
export interface SalesChannel extends WithId {
  shopId: string;
  name: string;
  code: "dineIn" | "takeaway" | "grab" | "lineman" | "shopeeFood" | null;
  /** true if this channel represents a physical table at the shop (dine-in). */
  requiresTable: boolean;
  color: string;
  icon: string | null;
  active: boolean;
  sortOrder: number;
  createdAt: EpochMillis;
  /**
   * Automatic price markup for this channel, as a whole percent (e.g. `20` for +20%) — item 23
   * turned on for delivery apps (Grab/LINE MAN/ShopeeFood commonly mark up menu prices to cover
   * platform commission). Applied by `lib/pos/pricing.ts`'s `resolveChannelPrice` on top of
   * `Product.price`, rounded up to the nearest 5 baht, UNLESS that product has a manual
   * `Product.channelPrices[channel.id]` override, which always wins outright. Absent (not just
   * `0`) on every channel from before this feature, and on any channel nobody's ever set a
   * markup for — every read must treat `undefined` the same as `0` (no markup, plain price).
   */
  markupPercent?: number;
}
