import type { OrderItem, StockLevel, StockMovement } from "@/types";

/**
 * Pure stock logic — no Firestore. Shared by the client stock service and the server-side
 * Telegram routes, unit-tested in `scripts/stock.test.ts`.
 */

/** Quantity sold per product on one order (an order can hold the same product on several lines). */
export function saleQuantitiesByProduct(items: Pick<OrderItem, "productId" | "quantity">[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity);
  return totals;
}

export function isLowStock(level: Pick<StockLevel, "qty" | "lowThreshold">): boolean {
  return level.qty <= level.lowThreshold;
}

/** True only on the sale that takes an item from above its threshold to at/below it — so
 * Telegram hears about each item running low once, not on every sale after. */
export function crossedLowThreshold(qtyBefore: number, qtyAfter: number, lowThreshold: number): boolean {
  return qtyBefore > lowThreshold && qtyAfter <= lowThreshold;
}

/** Parses a count/receive input box: blank means "not entered", anything else must be a
 * non-negative whole number. */
export function parseStockInput(text: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!/^\d+$/.test(trimmed)) return { ok: false };
  return { ok: true, value: Number(trimmed) };
}

export function formatDelta(delta: number): string {
  if (delta === 0) return "ตรง";
  return delta > 0 ? `เกิน ${delta}` : `ขาด ${-delta}`;
}

export function buildLowStockText(levels: Pick<StockLevel, "productName" | "qty">[]): string {
  const lines = levels.map((l) => `• ${l.productName} เหลือ ${l.qty}`);
  return `⚠️ สินค้าใกล้หมด\n${lines.join("\n")}`;
}

/**
 * Closing-count summary for Telegram: mismatches first (that's what the owner needs to see),
 * then a one-line tally of everything that matched, then anything now low.
 */
export function buildCountSummaryText(
  movements: Pick<StockMovement, "productName" | "delta" | "qtyAfter" | "createdByName">[],
  lowAfter: Pick<StockLevel, "productName" | "qty">[]
): string {
  const mismatched = movements.filter((m) => m.delta !== 0);
  const matched = movements.length - mismatched.length;
  const who = movements[0]?.createdByName ?? "-";
  const parts = [`📦 นับสต๊อกแล้ว (${movements.length} รายการ) โดย ${who}`];
  if (mismatched.length === 0) {
    parts.push("ตรงทุกรายการ ✅");
  } else {
    parts.push(mismatched.map((m) => `• ${m.productName} ${formatDelta(m.delta)} (นับได้ ${m.qtyAfter})`).join("\n"));
    if (matched > 0) parts.push(`ตรง ${matched} รายการ`);
  }
  if (lowAfter.length > 0) parts.push(buildLowStockText(lowAfter));
  return parts.join("\n\n");
}
