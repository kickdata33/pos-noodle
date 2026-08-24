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
}
