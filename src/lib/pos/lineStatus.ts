import type { OrderItem } from "@/types";

/**
 * Where a bill line is in the kitchen, as one short label for the order screen (approved design
 * "2 · สั่งอาหาร": each line shows ยังไม่ส่งครัว / รอครัว / ครัวทำแล้ว / เรียกเสิร์ฟแล้ว).
 * Pure; unit-tested in scripts/lineStatus.test.ts.
 */
export type LineKitchenStatus = "notSent" | "cooking" | "ready" | "served";

export function lineKitchenStatus(
  item: Pick<OrderItem, "quantity" | "kitchenSentQty" | "prepared" | "serveCalledAt" | "sendToKitchen">,
  kitchenPrintingOn: boolean
): LineKitchenStatus {
  if (item.serveCalledAt) return "served";
  if (item.prepared) return "ready";
  // With kitchen tickets, a line isn't in the kitchen until its ticket went out. Without them the
  // kitchen screen shows every line the moment it's added. A line whose category opts out of
  // kitchen tickets (`sendToKitchen === false`) never shows "ยังไม่ส่งครัว" — it was never going
  // to print one, so there's nothing to wait on.
  if (kitchenPrintingOn && item.sendToKitchen !== false && (item.kitchenSentQty ?? 0) < item.quantity) return "notSent";
  return "cooking";
}

export const LINE_STATUS_LABEL: Record<LineKitchenStatus, string> = {
  notSent: "ยังไม่ส่งครัว",
  cooking: "รอครัว",
  ready: "ครัวทำแล้ว",
  served: "เรียกเสิร์ฟแล้ว",
};

/** Text color classes per status — told apart by lightness as well as hue. */
export const LINE_STATUS_CLASS: Record<LineKitchenStatus, string> = {
  notSent: "text-destructive",
  cooking: "text-amber-700 dark:text-amber-300",
  ready: "text-success",
  served: "text-muted-foreground",
};
