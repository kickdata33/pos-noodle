import { collection, doc, runTransaction, type Transaction } from "firebase/firestore";

import { db } from "@/lib/firebase/client";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { crossedLowThreshold, saleQuantitiesByProduct } from "@/lib/pos/stock";
import type { AppUser, Order, StockLevel, StockMovement } from "@/types";

/**
 * Every write to stock goes through here, each as one transaction that reads the current
 * `qty`, applies a change, and logs a `StockMovement` with the before/after — so concurrent
 * sales, deliveries and counts can never overwrite each other's work.
 */

type Actor = Pick<AppUser, "id" | "name">;

function levelRef(productId: string) {
  return doc(db, COLLECTIONS.stockLevels, productId);
}

function writeMovement(tx: Transaction, movement: Omit<StockMovement, "id">) {
  tx.set(doc(collection(db, COLLECTIONS.stockMovements)), movement);
}

/** Fire-and-forget Telegram calls — the server re-reads the data itself and only ever posts to
 * the caller's own shop (see the routes). Never throws. */
function notify(path: string, body: unknown) {
  void fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(
    () => undefined
  );
}

/**
 * Takes a paid order's piece-sold items off the shelf (item: "ตัดอัตโนมัติเมื่อคิดเงิน").
 * Products that aren't stock-tracked are skipped silently. Alerts Telegram for any item this
 * sale pushed to/under its low threshold.
 */
export async function deductStockForPaidOrder(order: Pick<Order, "id" | "shopId" | "items">, actor: Actor): Promise<void> {
  const sold = saleQuantitiesByProduct(order.items);
  if (sold.size === 0) return;
  const crossed = await runTransaction(db, async (tx) => {
    const productIds = [...sold.keys()];
    const snaps = await Promise.all(productIds.map((id) => tx.get(levelRef(id))));
    const now = Date.now();
    const crossedIds: string[] = [];
    snaps.forEach((snap, i) => {
      if (!snap.exists()) return;
      const level = snap.data() as Omit<StockLevel, "id">;
      if (level.shopId !== order.shopId) return;
      const qtySold = sold.get(productIds[i])!;
      const qtyAfter = level.qty - qtySold;
      tx.update(snap.ref, { qty: qtyAfter, updatedAt: now });
      writeMovement(tx, {
        shopId: order.shopId,
        productId: productIds[i],
        productName: level.productName,
        type: "sale",
        delta: -qtySold,
        qtyBefore: level.qty,
        qtyAfter,
        orderId: order.id,
        countId: null,
        note: "",
        createdBy: actor.id,
        createdByName: actor.name,
        createdAt: now,
      });
      if (crossedLowThreshold(level.qty, qtyAfter, level.lowThreshold)) crossedIds.push(productIds[i]);
    });
    return crossedIds;
  });
  if (crossed.length > 0) notify("/api/notify/low-stock", { productIds: crossed });
}

/** Stock delivered — adds to whatever is there (never overwrites). */
export async function receiveStock(
  shopId: string,
  entries: { productId: string; qty: number }[],
  note: string,
  actor: Actor
): Promise<void> {
  const valid = entries.filter((e) => e.qty > 0);
  if (valid.length === 0) return;
  await runTransaction(db, async (tx) => {
    const snaps = await Promise.all(valid.map((e) => tx.get(levelRef(e.productId))));
    const now = Date.now();
    snaps.forEach((snap, i) => {
      if (!snap.exists()) return;
      const level = snap.data() as Omit<StockLevel, "id">;
      const qtyAfter = level.qty + valid[i].qty;
      tx.update(snap.ref, { qty: qtyAfter, updatedAt: now });
      writeMovement(tx, {
        shopId,
        productId: valid[i].productId,
        productName: level.productName,
        type: "receive",
        delta: valid[i].qty,
        qtyBefore: level.qty,
        qtyAfter,
        orderId: null,
        countId: null,
        note,
        createdBy: actor.id,
        createdByName: actor.name,
        createdAt: now,
      });
    });
  });
}

/**
 * Closing count: what's physically on the shelf becomes the new `qty`, and the difference from
 * what the system expected is logged per item (0 = matched). Then the owner gets the summary on
 * Telegram.
 */
export async function submitStockCount(
  shopId: string,
  entries: { productId: string; counted: number }[],
  actor: Actor
): Promise<void> {
  if (entries.length === 0) return;
  const countId = crypto.randomUUID();
  await runTransaction(db, async (tx) => {
    const snaps = await Promise.all(entries.map((e) => tx.get(levelRef(e.productId))));
    const now = Date.now();
    snaps.forEach((snap, i) => {
      if (!snap.exists()) return;
      const level = snap.data() as Omit<StockLevel, "id">;
      const counted = entries[i].counted;
      tx.update(snap.ref, { qty: counted, updatedAt: now });
      writeMovement(tx, {
        shopId,
        productId: entries[i].productId,
        productName: level.productName,
        type: "count",
        delta: counted - level.qty,
        qtyBefore: level.qty,
        qtyAfter: counted,
        orderId: null,
        countId,
        note: "",
        createdBy: actor.id,
        createdByName: actor.name,
        createdAt: now,
      });
    });
  });
  notify("/api/notify/stock-count", { countId });
}

/** Admin: start tracking a product with its current on-hand quantity. */
export async function startTrackingProduct(
  shopId: string,
  product: { id: string; name: string },
  initialQty: number,
  lowThreshold: number,
  actor: Actor
): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = levelRef(product.id);
    const snap = await tx.get(ref);
    if (snap.exists()) return;
    const now = Date.now();
    const level: Omit<StockLevel, "id"> = {
      shopId,
      productId: product.id,
      productName: product.name,
      qty: initialQty,
      lowThreshold,
      updatedAt: now,
    };
    tx.set(ref, level);
    writeMovement(tx, {
      shopId,
      productId: product.id,
      productName: product.name,
      type: "count",
      delta: initialQty,
      qtyBefore: 0,
      qtyAfter: initialQty,
      orderId: null,
      countId: null,
      note: "ตั้งยอดเริ่มต้น",
      createdBy: actor.id,
      createdByName: actor.name,
      createdAt: now,
    });
  });
}
