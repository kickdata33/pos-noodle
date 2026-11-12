import type { Order, OrderItem } from "@/types";
import { tableLabel } from "@/lib/tableLabel";

/**
 * Pure rules for the kitchen's "เรียกเสิร์ฟ" (unit-tested in scripts/serveCalls.test.ts).
 */

/** Marked ทำแล้ว on the kitchen screen but not yet called out to the floor. Lines prepared before
 * `preparedAt` existed have none and count as already served. */
export function awaitingServeCall(item: Pick<OrderItem, "prepared" | "preparedAt" | "serveCalledAt">): boolean {
  return Boolean(item.prepared && item.preparedAt && !item.serveCalledAt);
}

/** An order stays on the kitchen screen while anything is still to cook OR cooked-but-not-called. */
export function staysOnKitchenScreen(order: Pick<Order, "items">): boolean {
  return order.items.some((i) => !i.prepared || awaitingServeCall(i));
}

/**
 * Which lines a "เรียกเสิร์ฟ" tap sends out: the ones marked ทำแล้ว and not yet called. If the cook
 * didn't bother ticking individual lines, it's every line not yet called — and those get marked
 * prepared too, since the food is clearly ready.
 */
export function linesToCall(items: OrderItem[]): OrderItem[] {
  const ready = items.filter(awaitingServeCall);
  if (ready.length > 0) return ready;
  return items.filter((i) => !i.serveCalledAt && !(i.prepared && !i.preparedAt));
}

export function applyServeCall(items: OrderItem[], called: OrderItem[], now: number): OrderItem[] {
  const ids = new Set(called.map((i) => i.id));
  return items.map((i) =>
    ids.has(i.id) ? { ...i, prepared: true, preparedAt: i.preparedAt ?? now, serveCalledAt: now } : i
  );
}

export function serveCallLabel(order: Pick<Order, "tableName" | "customerLabel" | "channelName">): string {
  if (order.tableName) return tableLabel(order.tableName);
  return order.customerLabel ? `${order.channelName} ${order.customerLabel}` : order.channelName;
}

/** How long a fully served order stays in the kitchen screen's "เสิร์ฟแล้วล่าสุด" list, so a
 * mistaken "ทำแล้ว" / "เรียกเสิร์ฟ" can still be pulled back. */
export const RECENTLY_SERVED_MS = 60 * 60 * 1000;

/** Open orders that just left the kitchen list (everything cooked and called), newest first. */
export function recentlyServedOrders<T extends Pick<Order, "items">>(orders: T[], now: number): T[] {
  const lastCall = (o: T) => Math.max(0, ...o.items.map((i) => i.serveCalledAt ?? 0));
  return orders
    .filter((o) => !staysOnKitchenScreen(o) && now - lastCall(o) <= RECENTLY_SERVED_MS && lastCall(o) > 0)
    .sort((a, b) => lastCall(b) - lastCall(a));
}

/**
 * Undo a "เรียกเสิร์ฟ": puts the called lines back exactly as they were before (ticked or not),
 * on top of the order's CURRENT lines — anything added meanwhile is kept.
 */
export function undoServeCall(current: OrderItem[], before: OrderItem[], calledIds: string[]): OrderItem[] {
  const ids = new Set(calledIds);
  const prior = new Map(before.map((i) => [i.id, i]));
  return current.map((i) => {
    if (!ids.has(i.id)) return i;
    const was = prior.get(i.id);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { prepared, preparedAt, serveCalledAt, ...rest } = i;
    return {
      ...rest,
      prepared: Boolean(was?.prepared),
      ...(was?.preparedAt ? { preparedAt: was.preparedAt } : {}),
    };
  });
}
