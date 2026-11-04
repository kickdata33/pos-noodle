import type { Order, OrderItem } from "@/types";

/**
 * Pure helpers behind the kitchen screen's alert and "ใหม่" badges (`KitchenScreen`), unit-tested
 * in `scripts/kitchenAlerts.test.ts`.
 */

/** How long a just-added line keeps its "ใหม่" badge on the kitchen screen. */
export const KITCHEN_NEW_ITEM_WINDOW_MS = 5 * 60 * 1000;

/**
 * Compares the open orders now against the item ids the kitchen screen has already seen.
 * `hasNew` is true when any *unprepared* line appears that wasn't there before — whoever added
 * it (staff on the POS, a customer's QR order, a second round on an old table). `previouslySeen`
 * is `null` on the very first snapshot after the screen opens, which never alerts: orders already
 * waiting when the page loads shouldn't make the tablet chime.
 *
 * `seen` covers every current line (prepared or not), so a cook flipping a line back to
 * "ยังไม่ทำ" by mistake doesn't count as a new order.
 */
export function detectNewKitchenItems(
  previouslySeen: Set<string> | null,
  orders: Pick<Order, "items">[]
): { seen: Set<string>; hasNew: boolean } {
  const seen = new Set<string>();
  let hasNew = false;
  for (const order of orders) {
    for (const item of order.items) {
      seen.add(item.id);
      if (previouslySeen && !item.prepared && !previouslySeen.has(item.id)) hasNew = true;
    }
  }
  return { seen, hasNew };
}

/** Unprepared and added within the last few minutes — gets the "ใหม่" badge. Lines from before
 * `addedAt` existed never count as new. */
export function isNewKitchenItem(item: Pick<OrderItem, "prepared" | "addedAt">, now: number): boolean {
  return !item.prepared && item.addedAt !== undefined && now - item.addedAt < KITCHEN_NEW_ITEM_WINDOW_MS;
}

/**
 * Raising the quantity of a line the kitchen already marked "ทำแล้ว" must not hide the extra
 * portions behind that done mark. Instead of bumping the done line, the extra goes on as its own
 * fresh line (new id, not prepared, its own `addedAt`) so it shows up — and alerts — on the
 * kitchen screen. Unprepared lines are bumped in place as before.
 */
export function increaseItemQuantity(
  items: OrderItem[],
  target: OrderItem,
  delta: number,
  newId: string,
  now: number,
  computeLineTotal: (unitPrice: number, modifiers: OrderItem["modifiers"], quantity: number) => number
): OrderItem[] {
  if (target.prepared && delta > 0) {
    const extra: OrderItem = {
      id: newId,
      productId: target.productId,
      productName: target.productName,
      quantity: delta,
      unitPrice: target.unitPrice,
      modifiers: target.modifiers,
      note: target.note,
      lineTotal: computeLineTotal(target.unitPrice, target.modifiers, delta),
      addedAt: now,
    };
    return [...items, extra];
  }
  const newQty = target.quantity + delta;
  return items.map((i) =>
    i.id === target.id ? { ...i, quantity: newQty, lineTotal: computeLineTotal(i.unitPrice, i.modifiers, newQty) } : i
  );
}
