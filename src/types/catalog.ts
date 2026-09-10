import type { EpochMillis, WithId } from "./common";

/** e.g. ก๋วยเตี๋ยว, เกาเหลา, ลูกชิ้น, ของทานเล่น, เครื่องดื่ม — fully Admin-created (item 11). */
export interface Category extends WithId {
  shopId: string;
  name: string;
  sortOrder: number;
  active: boolean;
  createdAt: EpochMillis;
}

/**
 * Per-channel price override (item 23). Keyed by `SalesChannel.id`. A channel with no entry
 * here falls back to `Product.price`. Not surfaced in the UI yet in this milestone, but the
 * shape exists from day one so turning it on later needs no schema change.
 */
export type ChannelPrices = Record<string, number>;

export interface Product extends WithId {
  shopId: string;
  categoryId: string;
  name: string;
  /** Base price in the shop's currency's smallest *display* unit (baht, not satang). */
  price: number;
  channelPrices?: ChannelPrices;
  /** Modifier groups this product offers, e.g. [เส้น, เพิ่มเติม]. Order = display order. */
  modifierGroupIds: string[];
  active: boolean;
  sortOrder: number;
  createdAt: EpochMillis;
  updatedAt: EpochMillis;
}

export type ModifierSelectionType = "single" | "multiple";

/** e.g. Group "เส้น" (required, single-select) or "เพิ่มเติม" (optional, multi-select) — item 12. */
export interface ModifierGroup extends WithId {
  shopId: string;
  name: string;
  required: boolean;
  selectionType: ModifierSelectionType;
  /**
   * Caps how many options a `"multiple"` group's customer can pick at once (e.g. "เพิ่มลูกชิ้น"
   * capped at 3) — meaningless for `"single"` (already capped at 1 by `selectionType` itself) and
   * left `undefined` there. `undefined` or `0` on a `"multiple"` group means unlimited, same as
   * every group created before this field existed — every read must treat both the same as "no
   * cap". Enforced in two places that must never drift apart: `ModifierPickerDialog` (blocks the
   * tap once at the cap) and `resolveCustomerOrderItem` in `lib/pos/customerOrder.ts` (server-side
   * truncation — the real backstop, since the QR order API trusts nothing the request body says).
   */
  maxSelect?: number | null;
  active: boolean;
  sortOrder: number;
  createdAt: EpochMillis;
}

export interface ModifierOption extends WithId {
  shopId: string;
  groupId: string;
  name: string;
  /** Added to the item's unit price when selected. 0 for free options like "ไม่งอก". */
  priceDelta: number;
  active: boolean;
  sortOrder: number;
  createdAt: EpochMillis;
}
