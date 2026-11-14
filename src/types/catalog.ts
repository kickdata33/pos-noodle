import type { EpochMillis, WithId } from "./common";

/** e.g. ก๋วยเตี๋ยว, เกาเหลา, ลูกชิ้น, ของทานเล่น, เครื่องดื่ม — fully Admin-created (item 11). */
export interface Category extends WithId {
  shopId: string;
  name: string;
  sortOrder: number;
  active: boolean;
  /**
   * When `false`, products in this category never go out on a kitchen ticket (item:
   * "เครื่องดื่ม มิกเซอร์ อย่าให้เข้าครัว" — drinks/mixers the bar makes, not the kitchen).
   * Snapshotted onto `OrderItem.sendToKitchen` the moment a line is added, same reasoning as
   * every other order-item snapshot in this codebase (price, name): changing this toggle later
   * never rewrites lines already on an open bill. Only affects the printed kitchen ticket
   * (`computeKitchenSend`/`countUnsentToKitchen`) and this line's own "ยังไม่ส่งครัว" status
   * (`lineKitchenStatus`) — the live `/pos/kitchen` screen and its new-item alert are unchanged.
   * `null`/`undefined` (every category before this field existed, and the default for a new one)
   * means "send to kitchen as normal", same as today.
   */
  sendToKitchen?: boolean | null;
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
  /**
   * A link to a photo of this menu item — pasted in by Admin, same "URL, not upload" approach as
   * `ShopSettings.logoUrl` (this codebase has no file-upload/storage feature yet). Shown only on
   * the customer-facing self-order screens (`CustomerOrderScreen`, `PickupOrderScreen`) per the
   * shop's request — never on the staff POS grid, which stays as text-only as before. `null`/
   * `undefined` (every product from before this field existed, and any product with no photo)
   * just shows no image, same as today.
   */
  imageUrl?: string | null;
  channelPrices?: ChannelPrices;
  /** Modifier groups this product offers, e.g. [เส้น, เพิ่มเติม]. Order = display order. */
  modifierGroupIds: string[];
  /**
   * When set, an order line's name is built from this plus the `menuNameTag` of whichever
   * options were picked (item: "เลือกหมู ให้ขึ้นว่า ก๋วยเตี๋ยวหมู ถ้าเลือกเนื้อให้โชว์ก๋วยเตี๋ยวเนื้อ")
   * — e.g. base "ก๋วยเตี๋ยว" + tag "หมู" → "ก๋วยเตี๋ยวหมู". See `resolveItemName`. `null`/absent
   * (every product before this field) keeps `name` as the line name, unchanged.
   */
  menuNameBase?: string | null;
  /**
   * Quantity deals, e.g. เบียร์ "3 ขวด 200 บาท" while one bottle stays at `price` (item:
   * "เพิ่มฟังก์ชั่นโปรโมชั่น เบียร์ 3 ขวด ราคา xxx"). Shown on the POS as buttons staff tap to add
   * a whole set at the deal price (item: "ให้กดเลือกเป็นโปรโมชั่น ป้องกันพนักงานกดผิด"), only
   * while the deal's time window is running — see `activeDealsAt` and `OrderItem.bundleUnits`.
   * (Lines added while deals were still applied automatically keep their snapshotted
   * `OrderItem.bundleDeals` and are still priced by `computePromotionDiscount`.)
   * Only for products without option groups. Empty/absent = no deal.
   */
  bundleDeals?: BundleDeal[] | null;
  /**
   * A per-piece price that overrides `price` during a time window, e.g. "หลัง 20:00 ลดเหลือ 599"
   * or a lunch-only special — the single-item counterpart to `bundleDeals` above, for a shop that
   * wants a time-based price without requiring a multi-piece purchase (item: "โปรราคาพิเศษ
   * ช่วงเวลา สำหรับซื้อ 1 ชิ้น"). See `resolveTimeBasedPrice` in `lib/pos/pricing.ts`. Only applies
   * to the plain storefront price (same restriction as `bundleDeals` — a channel with its own
   * `channelPrices` override or markup is unaffected), and, like `bundleDeals`, only while this
   * product has no option groups selected through `activeDealsAt`'s unit-price check (a time
   * price simply becomes the new `price` those comparisons run against). Windows must not overlap
   * each other (validated on save — only one price can be in effect at any one moment). Empty/
   * absent = no override, exactly like every product before this field existed.
   */
  timePrices?: TimePriceRule[] | null;
  /**
   * Hidden from the customer QR menus (dine-in and pickup) and refused by their order APIs, but
   * still on the staff POS — for items staff recommend or that must be ordered through staff.
   * `false`/absent = shown to customers as before.
   */
  staffOnly?: boolean;
  /**
   * Staff-only one-tap shortcuts for this product's most common modifier combos (e.g. "ก๋วยเตี๋ยว
   * พิเศษ" = เนื้อสัตว์: พิเศษ, all pre-picked) — tapping one adds the item straight to the cart
   * with these selections already applied, skipping `ModifierPickerDialog` entirely. Purely a POS
   * speed feature: the customer-facing self-order screens (`CustomerOrderScreen`,
   * `PickupOrderScreen`) never read this field and always show the full picker, same as before —
   * see those components' comments. `undefined`/empty for every product before this field
   * existed, or one with no shortcuts defined; the base product tile with the full picker is
   * always still available regardless.
   */
  posQuickPresets?: ProductQuickPreset[];
  active: boolean;
  sortOrder: number;
  createdAt: EpochMillis;
  updatedAt: EpochMillis;
}

/**
 * One staff-facing quick-add shortcut on a product — see `Product.posQuickPresets`. `selections`
 * has the exact same shape as `ModifierPickerDialog`'s own selection state
 * (`Record<groupId, optionId[]>`), so `resolveModifiersFromSelections` in `lib/pos/pricing.ts`
 * can turn either one into the same `OrderItemModifier[]` the cart actually stores.
 */
export interface ProductQuickPreset {
  id: string;
  /** Button label on the POS grid, e.g. "ก๋วยเตี๋ยวพิเศษ". */
  label: string;
  selections: Record<string, string[]>;
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

/** "ซื้อ `qty` ชิ้น ราคา `price` บาท" — see `Product.bundleDeals`. */
export interface BundleDeal {
  qty: number;
  price: number;
  /**
   * Optional time window, shop time (Bangkok), "HH:MM" — the deal only applies to lines added
   * from `fromTime` (inclusive) until `toTime` (exclusive), e.g. "3 ขวด 189 ก่อน 20:00" and
   * "3 ขวด 219 ตั้งแต่ 20:00" (item: "โปรโมชั่นระบุเวลาได้"). A window may cross midnight
   * ("20:00"–"02:00"). Blank `fromTime` = from 00:00, blank `toTime` = until midnight, both blank
   * = all day (every deal before this field existed).
   */
  fromTime?: string | null;
  toTime?: string | null;
}

/**
 * One time-based price override — see `Product.timePrices`. Same "HH:MM", shop-time (Bangkok),
 * window rules as `BundleDeal.fromTime`/`toTime` (may cross midnight; blank = open-ended on that
 * side). Unlike a `BundleDeal`, `price` here isn't required to be a discount — a shop may also
 * use this for a time-based surcharge — so nothing compares it against `Product.price` to decide
 * whether it "counts"; whatever window is active simply replaces the price outright.
 */
export interface TimePriceRule {
  price: number;
  fromTime?: string | null;
  toTime?: string | null;
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
  /**
   * When a customer's pick from this group is the real distinction between what otherwise reads
   * as "the same product" in "สินค้าขายดี" (top-sellers) — e.g. a required single-select
   * "เนื้อสัตว์" group of หมู/เนื้อ/ต้มยำ on one "ก๋วยเตี๋ยว" product (item: "ต้องการให้แยก ก๋วยเตี๋ยว
   * เนื้อ หมู ต้มยำ แยกออก" — the shop's Telegram daily summary and `/admin/reports` were both
   * combining every meat choice into one "ก๋วยเตี๋ยวหมู / เนื้อ" line because they only ever grouped
   * by `productId`) — flip this on and `topProducts` (`lib/pos/reports.ts`) breaks that product's
   * sales into one line per option picked from this group instead of one combined total. Off by
   * default (and for every group created before this field existed), since splitting by every
   * modifier (e.g. "ไม่ใส่ผักชี") would make most products' reporting unreadably granular — this is
   * an explicit per-group opt-in, not automatic from `required`/`selectionType`.
   */
  splitSalesReport?: boolean;
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
  /**
   * Word added to the line name of a product that has `menuNameBase` when this option is picked,
   * e.g. "หมู" on หมูสด/หมูเด้ง/ลูกชิ้นหมู and "เนื้อ" on เนื้อเปื่อย/เนื้อสด. A tag, not a full name,
   * because one option group is often shared by several products (ก๋วยเตี๋ยว, เกาเหลา) — each
   * product supplies its own base. Ignored on products without `menuNameBase`.
   */
  menuNameTag?: string | null;
  active: boolean;
  sortOrder: number;
  createdAt: EpochMillis;
}
