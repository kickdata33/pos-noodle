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

export type ModifierPricingMode = "perOption" | "tieredByCount";

/**
 * Only meaningful when `ModifierGroup.pricingMode === "tieredByCount"` — the group's total
 * add-on price for selecting exactly `count` options from it, e.g. for "เนื้อสัตว์": `[{count:
 * 1, price: 50}, {count: 2, price: 50}, {count: 3, price: 60}]`. Every option's own `priceDelta`
 * is ignored in this mode — only the *number* selected decides the price, not which ones.
 */
export interface ModifierTier {
  count: number;
  price: number;
}

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
   * `"tieredByCount"` pricing (below) additionally *requires* this to be set, since a tier list
   * needs a known upper bound.
   */
  maxSelect?: number | null;
  /**
   * How this group prices a selection — `"perOption"` (default: each selected option's own
   * `priceDelta` adds independently, the original/only behavior before this field existed) or
   * `"tieredByCount"` (the shop charges by *how many* options are picked, not which ones — e.g.
   * "เนื้อสัตว์": 1 or 2 kinds = 50 บาท, 3 kinds = 60 บาท, see `tierPricing`). `undefined` on
   * every group from before this field existed — every read must treat that the same as
   * `"perOption"`.
   */
  pricingMode?: ModifierPricingMode | null;
  /** See `ModifierTier`. Only read when `pricingMode === "tieredByCount"`. Nullable (like
   * `maxSelect` above) so the Admin UI can explicitly clear it when switching a group back to
   * `"perOption"` pricing, rather than leaving a stale tier list sitting unused in Firestore. */
  tierPricing?: ModifierTier[] | null;
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
  /**
   * Limits this one option to specific products, even though its group is shared by several
   * (e.g. the shared "เนื้อสัตว์" group's "โครงไก่" option should only show on "เกาเหลา", not
   * every other product — like "ก๋วยเตี๋ยว" — that also uses that group). `null`/`undefined`
   * (the default, and every option created before this field existed) means "show on every
   * product that offers this group", unchanged from before this feature. Enforced in the same
   * two places `ModifierGroup.maxSelect` is, for the same reason: `ModifierPickerDialog` (hides
   * the option from products it's not restricted to) and `resolveCustomerOrderItem` in
   * `lib/pos/customerOrder.ts` (server-side backstop for customer/QR orders).
   */
  restrictToProductIds?: string[] | null;
  active: boolean;
  sortOrder: number;
  createdAt: EpochMillis;
}
