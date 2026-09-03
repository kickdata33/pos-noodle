import type { OrderItem, OrderItemModifier, ShopSettings } from "@/types";

/** (unitPrice + sum of modifier priceDelta) * quantity — item 21/22. */
export function computeLineTotal(
  unitPrice: number,
  modifiers: OrderItemModifier[],
  quantity: number
): number {
  const modifierTotal = modifiers.reduce((sum, m) => sum + m.priceDelta, 0);
  return (unitPrice + modifierTotal) * quantity;
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
