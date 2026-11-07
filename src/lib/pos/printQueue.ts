import { collection, doc, writeBatch } from "firebase/firestore";

import { db } from "@/lib/firebase/client";
import { COLLECTIONS } from "@/lib/firebase/collections";
import {
  autoReceiptJobId,
  checkBillJobFields,
  computeKitchenSend,
  kitchenJobFields,
  receiptJobFields,
  tableQrJobFields,
} from "@/lib/pos/printTickets";
import type { Order, OrderItem, PrintJob, ShopSettings } from "@/types";

/**
 * Client-side glue between the POS screens and the `printJobs` queue. Each function writes the
 * order change and the new job in ONE batch, so "kitchen already knows about these items" and
 * "a ticket for these items exists" can never disagree — otherwise a failed job write would
 * silently drop food, or a failed order write would print the same food twice next time.
 *
 * Every function is a no-op (returns `false`) when its switch in `ShopSettings.printStation` is
 * off — callers just call it, they never need to check settings themselves.
 */

function newJobRef() {
  return doc(collection(db, COLLECTIONS.printJobs));
}

/**
 * Sends whatever the kitchen hasn't seen yet on this (already saved) order. Returns the updated
 * items so the caller can put them in its local state, or `null` if nothing was sent.
 */
export async function sendOrderToKitchen(
  order: Order,
  settings: ShopSettings | null,
  createdBy: string
): Promise<{ items: OrderItem[]; kitchenTicketCount: number } | null> {
  if (!settings?.printStation?.kitchenEnabled) return null;
  const send = computeKitchenSend(order.items);
  if (!send) return null;
  const round = (order.kitchenTicketCount ?? 0) + 1;
  const now = Date.now();
  const job: Omit<PrintJob, "id"> = {
    ...kitchenJobFields(order, send, round),
    shopId: order.shopId,
    createdBy,
    createdAt: now,
  };
  const batch = writeBatch(db);
  batch.update(doc(db, COLLECTIONS.orders, order.id), {
    items: send.updatedItems,
    kitchenTicketCount: round,
    updatedAt: now,
  });
  batch.set(newJobRef(), job);
  await batch.commit();
  return { items: send.updatedItems, kitchenTicketCount: round };
}

/**
 * A line the kitchen already received was deleted from the order (or the whole order was
 * cancelled) — tell the kitchen to stop. `removed` must be the items as they were *before*
 * removal; only the part already sent (`kitchenSentQty`) is printed. The order document itself
 * is written by the caller's normal remove/cancel path, so this only adds the job.
 */
export async function sendKitchenCancellation(
  order: Order,
  removed: OrderItem[],
  settings: ShopSettings | null,
  createdBy: string
): Promise<boolean> {
  if (!settings?.printStation?.kitchenEnabled) return false;
  const cancelled = removed
    .filter((i) => (i.kitchenSentQty ?? 0) > 0)
    .map((item) => ({ item, quantity: item.kitchenSentQty ?? 0 }));
  if (cancelled.length === 0) return false;
  const job: Omit<PrintJob, "id"> = {
    ...kitchenJobFields(order, { added: [], cancelled }, order.kitchenTicketCount ?? 0),
    shopId: order.shopId,
    createdBy,
    createdAt: Date.now(),
  };
  const batch = writeBatch(db);
  batch.set(newJobRef(), job);
  await batch.commit();
  return true;
}

/**
 * Queues a check bill. With `onlyIfChanged`, skips printing when a bill for this exact total was
 * already printed (staff closing and reopening "คิดเงิน" shouldn't waste paper); the explicit
 * "พิมพ์บิลอีกครั้ง" button passes `false`.
 */
export async function printCheckBill(
  order: Order,
  settings: ShopSettings | null,
  createdBy: string,
  onlyIfChanged: boolean
): Promise<boolean> {
  if (!settings?.printStation?.checkBillEnabled) return false;
  if (onlyIfChanged && order.checkBillPrintedTotal === order.total) return false;
  const now = Date.now();
  const job: Omit<PrintJob, "id"> = {
    ...checkBillJobFields(order, settings),
    shopId: order.shopId,
    createdBy,
    createdAt: now,
  };
  const batch = writeBatch(db);
  batch.update(doc(db, COLLECTIONS.orders, order.id), { checkBillPrintedTotal: order.total });
  batch.set(newJobRef(), job);
  await batch.commit();
  return true;
}

/** Queues a table's self-order QR slip at the cashier station. No order involved. */
export async function printTableQr(
  shopId: string,
  input: { shopName: string; tableName: string; url: string; sessionMode: boolean },
  createdBy: string
): Promise<void> {
  const job: Omit<PrintJob, "id"> = { ...tableQrJobFields(input), shopId, createdBy, createdAt: Date.now() };
  const batch = writeBatch(db);
  batch.set(newJobRef(), job);
  await batch.commit();
}

/**
 * A deliberate reprint of an earlier job (POS problem list "พิมพ์ใหม่", or reprinting a
 * receipt): always a brand-new job with the same content, linked by `reprintOf` — never a reset
 * of the old job, so the history of what happened to the original stays intact.
 */
export async function reprintJob(original: PrintJob, createdBy: string): Promise<void> {
  const job: Omit<PrintJob, "id"> = {
    shopId: original.shopId,
    station: original.station,
    kind: original.kind,
    orderId: original.orderId,
    lines: original.lines,
    qrPayload: original.qrPayload,
    qrCaption: original.qrCaption,
    status: "pending",
    claimedBy: null,
    error: null,
    printedAt: null,
    createdBy,
    createdAt: Date.now(),
    reprintOf: original.id,
  };
  const batch = writeBatch(db);
  batch.set(newJobRef(), job);
  await batch.commit();
}

/** Reprint a paid order's receipt on purpose — a new job each time. */
export async function reprintReceipt(order: Order, settings: ShopSettings, createdBy: string): Promise<void> {
  const job: Omit<PrintJob, "id"> = {
    ...receiptJobFields(order, settings),
    shopId: order.shopId,
    createdBy,
    createdAt: Date.now(),
    reprintOf: autoReceiptJobId(order.id),
  };
  const batch = writeBatch(db);
  batch.set(newJobRef(), job);
  await batch.commit();
}
