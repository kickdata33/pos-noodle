import type { ModifierTier, OrderItem, OrderItemModifier, Product, SalesChannel, ShopSettings } from "@/types";

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
 * What this product actually costs when ordered on a given channel — item 23 turned on for
 * delivery apps (confirmed with the shop): Grab/LINE MAN/ShopeeFood commonly mark menu prices
 * up to cover platform commission, each app usually by a different percent.
 *
 * Resolution order:
 * 1. A manual per-item override in `Product.channelPrices[channel.id]` always wins outright —
 *    an admin who set an exact price for this one item on this one channel meant it literally,
 *    markup or not.
 * 2. Otherwise apply the channel's `markupPercent` on top of the plain `Product.price`, rounded
 *    UP to the nearest 5 baht (the shop's rounding rule) — rounding up, never down, so the shop
 *    is never left quietly eating part of the platform's commission from a rounding loss.
 * 3. No channel (`null` — dine-in draft still resolving its channel) or a channel with no
 *    markup set falls straight through to the plain price, unchanged from before this feature.
 */
export function resolveChannelPrice(
  product: Pick<Product, "price" | "channelPrices">,
  channel: Pick<SalesChannel, "id" | "markupPercent"> | null
): number {
  if (!channel) return product.price;
  const override = product.channelPrices?.[channel.id];
  if (override !== undefined) return override;
  const markupPercent = channel.markupPercent ?? 0;
  if (markupPercent === 0) return product.price;
  return roundUpToNearest5(product.price * (1 + markupPercent / 100));
}

function roundUpToNearest5(value: number): number {
  return Math.ceil(value / 5) * 5;
}

export interface OrderTotals {
  subtotal: number;
  discount: number;
  serviceCharge: number;
  tax: number;
  total: number;
}

/**
 * VAT is computed on (subtotal - discount + serviceCharge), the standard Thai restaurant
 * convention — service charge is itself taxable. `discount` is always 0 in this milestone (no
 * staff-facing discount UI yet, see progress notes) but the parameter exists so this function
 * doesn't need to change shape when that UI is added later.
 */
export function computeOrderTotals(
  items: Pick<OrderItem, "lineTotal">[],
  settings: Pick<ShopSettings, "vatEnabled" | "vatRate" | "serviceChargeEnabled" | "serviceChargeRate">,
  discount = 0
): OrderTotals {
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const serviceCharge = settings.serviceChargeEnabled
    ? round2((subtotal * settings.serviceChargeRate) / 100)
    : 0;
  const taxable = subtotal - discount + serviceCharge;
  const tax = settings.vatEnabled ? round2((taxable * settings.vatRate) / 100) : 0;
  const total = round2(subtotal - discount + serviceCharge + tax);

  return { subtotal: round2(subtotal), discount, serviceCharge, tax, total };
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
    const group = groups.find((g) => g.productId === item.productId);
    if (group) {
      group.totalQty += item.quantity;
      group.items.push(item);
    } else {
      groups.push({ productId: item.productId, productName: item.productName, totalQty: item.quantity, items: [item] });
    }
  }
  return groups;
}
