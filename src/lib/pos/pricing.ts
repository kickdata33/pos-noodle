import type {
  BundleDeal,
  ModifierGroup,
  ModifierOption,
  ModifierTier,
  OrderItem,
  OrderItemModifier,
  Product,
  SalesChannel,
  ShopSettings,
} from "@/types";

/** (unitPrice + sum of modifier priceDelta) * quantity — item 21/22. */
export function computeLineTotal(
  unitPrice: number,
  modifiers: OrderItemModifier[],
  quantity: number
): number {
  const modifierTotal = modifiers.reduce((sum, m) => sum + m.priceDelta, 0);
  return (unitPrice + modifierTotal) * quantity;
}

/**
 * A `"tieredByCount"` modifier group's total add-on price for selecting `count` options — the
 * tier whose `count` exactly matches wins; if the group's tier list doesn't have an exact match
 * (e.g. misconfigured, or `count` is 0) it falls back to the next tier *below* `count`, or 0 if
 * there isn't one, rather than throwing — the group still has to price *something* for whatever
 * was actually selected. Pure so it's usable identically client-side (`ModifierPickerDialog`,
 * for the live preview and for what the staff POS actually persists) and server-side
 * (`resolveCustomerOrderItem`, the authoritative price for customer/QR orders) — see the
 * `maxSelect` doc comment on `ModifierGroup` for why these two paths must never drift apart.
 */
export function resolveTieredGroupPrice(tierPricing: ModifierTier[] | null | undefined, count: number): number {
  if (!tierPricing || count <= 0) return 0;
  let best: ModifierTier | null = null;
  for (const tier of tierPricing) {
    if (tier.count <= count && (!best || tier.count > best.count)) best = tier;
  }
  return best?.price ?? 0;
}

/**
 * Turns a `"tieredByCount"` group's chosen options into each option's individual `priceDelta`
 * — every option gets 0 except the last, which carries the group's whole tier price, so
 * `computeLineTotal`'s ordinary per-modifier sum lands on the right total without needing its
 * own tiered-pricing branch. The group's real per-option names/ids are kept (unlike collapsing
 * to one synthetic line) so the kitchen/receipt still show which meats were actually picked and
 * the customer order flow can still round-trip real option ids back to the server.
 */
export function distributeTieredPriceDeltas(count: number, totalPrice: number): number[] {
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? totalPrice : 0));
}

/**
 * Turns a `groupId -> optionId[]` selection map into the flattened `OrderItemModifier[]` the
 * cart actually stores — the one place this logic lives, shared by `ModifierPickerDialog`'s
 * manual picker and a product's `posQuickPresets` quick-add shortcuts, so a preset can never
 * price a combo differently than picking the exact same options by hand would. `groups` should
 * already be filtered to the product's own `modifierGroupIds` (active groups only); options not
 * offered on `productId` (via `restrictToProductIds`) or no longer found are silently skipped
 * rather than throwing, since a preset baked in weeks ago may reference an option an admin has
 * since deleted.
 */
export function resolveModifiersFromSelections(
  groups: ModifierGroup[],
  selections: Record<string, string[]>,
  modifierOptions: ModifierOption[],
  productId: string
): OrderItemModifier[] {
  return groups.flatMap((group) => {
    const chosenIds = selections[group.id] ?? [];
    const groupOptions = modifierOptions.filter(
      (o) => o.groupId === group.id && (!o.restrictToProductIds || o.restrictToProductIds.includes(productId))
    );
    // Tiered groups price by *how many* were chosen, not which ones — see
    // `distributeTieredPriceDeltas`'s doc comment. Every other group keeps each option's own
    // `priceDelta`, unchanged from before this feature.
    const tieredDeltas =
      group.pricingMode === "tieredByCount"
        ? distributeTieredPriceDeltas(chosenIds.length, resolveTieredGroupPrice(group.tierPricing, chosenIds.length))
        : null;
    return chosenIds.flatMap((optionId, index) => {
      const option = groupOptions.find((o) => o.id === optionId);
      if (!option) return [];
      return [
        {
          groupId: group.id,
          groupName: group.name,
          optionId: option.id,
          optionName: option.name,
          priceDelta: tieredDeltas ? tieredDeltas[index] : option.priceDelta,
        },
      ];
    });
  });
}

/**
 * What this product actually costs when ordered on a given channel — item 23 turned on for
 * delivery apps (confirmed with the shop): Grab/LINE MAN/ShopeeFood commonly mark menu prices
 * up to cover platform commission, each app usually by a different percent.
 *
 * Resolution order:
 * 1. A manual per-item override in `Product.channelPrices[channel.id]` always wins outright —
 *    an admin who set an exact price for this one item on this one channel meant it literally,
 *    markup or not.
 * 2. Otherwise, a channel with a nonzero `markupPercent` applies it on top of the plain
 *    `Product.price`, rounded UP to the nearest 5 baht (the shop's rounding rule) — rounding up,
 *    never down, so the shop is never left quietly eating part of the platform's commission from
 *    a rounding loss.
 * 3. Every other case — no channel at all (`null`, a dine-in draft still resolving its channel),
 *    or a real channel with no override and no markup (the dine-in/"หน้าร้าน" channel itself,
 *    which is exactly this case in every shop today) — resolves through `resolveTimeBasedPrice`
 *    instead of straight to `Product.price`. This is "the plain storefront price" in the same
 *    sense `bundleDeals`/`activeDealsAt` mean it: a time-based price only ever applies here, never
 *    to a marked-up or individually-overridden channel (delivery channels quote off the listed
 *    price, not a dine-in happy-hour rate).
 *
 * `now` defaults to the current time so ordinary callers don't have to pass it — it exists as a
 * parameter purely so this stays callable deterministically from tests and from React render
 * (pass the screen's own ticking clock state, never `Date.now()` directly in render).
 */
export function resolveChannelPrice(
  product: Pick<Product, "price" | "channelPrices" | "timePrices">,
  channel: Pick<SalesChannel, "id" | "markupPercent"> | null,
  now: number = Date.now()
): number {
  const override = channel ? product.channelPrices?.[channel.id] : undefined;
  if (override !== undefined) return override;
  const markupPercent = channel?.markupPercent ?? 0;
  if (markupPercent === 0) return resolveTimeBasedPrice(product, now);
  return roundUpToNearest5(product.price * (1 + markupPercent / 100));
}

/**
 * The storefront price right now — `Product.price`, unless a `Product.timePrices` window covers
 * this moment (shop/Bangkok time), in which case that rule's price replaces it outright. Windows
 * are validated not to overlap when saved (`parseTimePrices` in the admin products page), so at
 * most one can ever match; if more than one somehow did, the first match wins. See
 * `Product.timePrices`'s own comment for why this doesn't compare against the normal price the
 * way `activeDealsAt` does for `bundleDeals` — a time price isn't required to be a discount.
 */
export function resolveTimeBasedPrice(product: Pick<Product, "price" | "timePrices">, now: number): number {
  const minute = bangkokMinuteOfDay(now);
  const active = (product.timePrices ?? []).find((r) => isDealActiveAt(r, minute));
  return active ? active.price : product.price;
}

function roundUpToNearest5(value: number): number {
  return Math.ceil(value / 5) * 5;
}

export interface OrderTotals {
  subtotal: number;
  /** Everything taken off the subtotal — today only `promoDiscount`, plus any manual discount
   * passed in (no staff discount UI exists yet). */
  discount: number;
  promoDiscount: number;
  serviceCharge: number;
  tax: number;
  total: number;
}

/**
 * Baht saved by quantity deals (`Product.bundleDeals`, snapshotted per line). Units of the same
 * product at the same unit price are pooled across lines (three separate one-bottle taps = one
 * three-bottle deal), then filled greedily with the biggest deal first; leftovers pay the normal
 * price. A deal that wouldn't actually be cheaper than buying singly is ignored. Modifier add-ons
 * are never discounted — the deal covers the base price only.
 */
/**
 * Deals running at `now` (shop time) that the POS should offer as "โปร" buttons for this product
 * on this channel — none on a channel with its own/marked-up price (deals are set against the
 * normal price), none for products with option groups (a set has no way to pick options per
 * piece), and only deals that are actually cheaper than buying the pieces singly.
 */
export function activeDealsAt(
  product: Pick<Product, "price" | "bundleDeals" | "modifierGroupIds">,
  unitPrice: number,
  now: number
): BundleDeal[] {
  if (unitPrice !== product.price || product.modifierGroupIds.length > 0) return [];
  const minute = bangkokMinuteOfDay(now);
  return (product.bundleDeals ?? []).filter(
    (d) => d.qty >= 2 && d.price < d.qty * product.price && isDealActiveAt(d, minute)
  );
}

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Minutes since midnight in shop time — computed from the UTC epoch so the server (UTC on
 * Vercel) and a staff tablet agree. */
export function bangkokMinuteOfDay(epochMs: number): number {
  const d = new Date(epochMs + BANGKOK_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** "HH:MM" → minutes since midnight, or `null` for blank/invalid. */
export function parseClock(value: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** Whether a deal's time window covers `minute` (see `BundleDeal.fromTime`). */
export function isDealActiveAt(deal: Pick<BundleDeal, "fromTime" | "toTime">, minute: number): boolean {
  const from = parseClock(deal.fromTime) ?? 0;
  const to = parseClock(deal.toTime) ?? 24 * 60;
  if (from === to) return true;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

/** Two deals' windows share at least one minute of the day. */
export function dealWindowsOverlap(
  a: Pick<BundleDeal, "fromTime" | "toTime">,
  b: Pick<BundleDeal, "fromTime" | "toTime">
): boolean {
  for (let m = 0; m < 24 * 60; m++) if (isDealActiveAt(a, m) && isDealActiveAt(b, m)) return true;
  return false;
}

/** Short label for a deal's window: "", "ก่อน 20:00", "ตั้งแต่ 20:00", "17:00–20:00". */
export function dealWindowLabel(deal: Pick<BundleDeal, "fromTime" | "toTime">): string {
  const from = parseClock(deal.fromTime) === null ? null : deal.fromTime!.trim();
  const to = parseClock(deal.toTime) === null ? null : deal.toTime!.trim();
  if (from && to) return `${from}–${to}`;
  if (to) return `ก่อน ${to}`;
  if (from) return `ตั้งแต่ ${from}`;
  return "";
}

type PromoItem = Partial<Pick<OrderItem, "productId" | "unitPrice" | "quantity" | "bundleDeals">>;

export function computePromotionDiscount(items: PromoItem[]): number {
  const pools = new Map<string, { unitPrice: number; units: number; deals: { qty: number; price: number }[] }>();
  for (const item of items) {
    if (!item.bundleDeals || item.bundleDeals.length === 0) continue;
    if (item.productId === undefined || item.unitPrice === undefined || item.quantity === undefined) continue;
    // Same product, same price, same deals — lines snapshotted in different time windows carry
    // different deals and so never pool together.
    const key = `${item.productId}@${item.unitPrice}@${JSON.stringify(item.bundleDeals)}`;
    const pool = pools.get(key) ?? { unitPrice: item.unitPrice, units: 0, deals: item.bundleDeals };
    pool.units += item.quantity;
    pools.set(key, pool);
  }
  let saved = 0;
  for (const pool of pools.values()) {
    const deals = pool.deals
      .filter((d) => d.qty >= 2 && d.price >= 0 && d.price < d.qty * pool.unitPrice)
      .slice()
      .sort((a, b) => b.qty - a.qty);
    let remaining = pool.units;
    for (const deal of deals) {
      const times = Math.floor(remaining / deal.qty);
      if (times === 0) continue;
      saved += times * (deal.qty * pool.unitPrice - deal.price);
      remaining -= times * deal.qty;
    }
  }
  return round2(saved);
}

/**
 * VAT is computed on (subtotal - discount + serviceCharge), the standard Thai restaurant
 * convention — service charge is itself taxable. The promotion discount is always recomputed
 * from the items here, so callers must pass only a *manual* discount (none exist yet → leave it
 * 0) — never an order's stored `discount`, which already includes the promotion and would count
 * it twice.
 */
export function computeOrderTotals(
  items: (Pick<OrderItem, "lineTotal"> & PromoItem)[],
  settings: Pick<ShopSettings, "vatEnabled" | "vatRate" | "serviceChargeEnabled" | "serviceChargeRate">,
  manualDiscount = 0
): OrderTotals {
  const promoDiscount = computePromotionDiscount(items);
  const discount = round2(manualDiscount + promoDiscount);
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const serviceCharge = settings.serviceChargeEnabled
    ? round2((subtotal * settings.serviceChargeRate) / 100)
    : 0;
  const taxable = subtotal - discount + serviceCharge;
  const tax = settings.vatEnabled ? round2((taxable * settings.vatRate) / 100) : 0;
  const total = round2(subtotal - discount + serviceCharge + tax);

  return { subtotal: round2(subtotal), discount, promoDiscount, serviceCharge, tax, total };
}

/** Avoids floating-point noise like 12.000000000000002 baht showing up on a receipt. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface ItemGroup {
  productId: string;
  productName: string;
  totalQty: number;
  items: OrderItem[];
}

/**
 * Groups order lines by product for display only (the cart, and the checkout summary) — never
 * for storage, so this stays a pure function over whatever `OrderItem[]` is passed in. Two
 * separate taps of the same product with different notes (e.g. "ก๋วยเตี๋ยวหมู" once "ไม่งอก",
 * once "ไม่ผัก") should read as one "ก๋วยเตี๋ยวหมู x2" line while still showing each note — see
 * `OrderScreen`'s cart and `CheckoutDialog`'s summary, which both render this the same way so
 * what staff see while ordering matches exactly what they confirm at the register.
 */
export function groupItemsByProduct(items: OrderItem[]): ItemGroup[] {
  const groups: ItemGroup[] = [];
  for (const item of items) {
    // Same product under a different line name (ก๋วยเตี๋ยวหมู vs ก๋วยเตี๋ยวเนื้อ, see
    // `resolveItemName`) stays a separate group, so the cart reads the way the kitchen will.
    const group = groups.find((g) => g.productId === item.productId && g.productName === item.productName);
    if (group) {
      group.totalQty += item.quantity;
      group.items.push(item);
    } else {
      groups.push({ productId: item.productId, productName: item.productName, totalQty: item.quantity, items: [item] });
    }
  }
  return groups;
}
