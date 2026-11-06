import { collection, doc, runTransaction } from "firebase/firestore";

import { db } from "@/lib/firebase/client";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { computeOrderTotals } from "@/lib/pos/pricing";
import type { Order, ShopSettings } from "@/types";

/**
 * Creates the first order on a table — or, if another device (or a customer's QR order) got
 * there first, adds this draft's items to *that* order instead (item: "ตอนสร้างโต๊ะจากอีกเครื่อง
 * ให้อีกเครื่องเห็นด้วย ไม่งั้นมันจะสร้างซ้ำ").
 *
 * Firestore client transactions can't run queries, so "is this table already taken?" is answered
 * through a pointer doc, `tableOccupancy/{tableId}` → orderId, read and written inside the same
 * transaction as the order. Two devices racing both read the pointer; Firestore retries the loser,
 * which then sees the winner's order and joins it. The pointer is never trusted on its own — the
 * order it names must still be OPEN on this very table (paid, cancelled or moved orders leave
 * stale pointers behind, and those are simply overwritten).
 */
export async function createOrJoinTableOrder(
  draft: Omit<Order, "id">,
  tableId: string,
  settings: Pick<ShopSettings, "vatEnabled" | "vatRate" | "serviceChargeEnabled" | "serviceChargeRate">
): Promise<{ id: string; joined: boolean }> {
  const lockRef = doc(db, COLLECTIONS.tableOccupancy, tableId);
  const newOrderRef = doc(collection(db, COLLECTIONS.orders));
  return runTransaction(db, async (tx) => {
    const lockSnap = await tx.get(lockRef);
    const heldBy = lockSnap.exists() ? (lockSnap.data().orderId as string | undefined) : undefined;
    if (heldBy) {
      const existingSnap = await tx.get(doc(db, COLLECTIONS.orders, heldBy));
      const existing = existingSnap.exists() ? (existingSnap.data() as Omit<Order, "id">) : null;
      if (existing && existing.status === "OPEN" && existing.tableId === tableId && existing.shopId === draft.shopId) {
        const items = [...existing.items, ...draft.items];
        tx.update(existingSnap.ref, { items, ...computeOrderTotals(items, settings), updatedAt: Date.now() });
        return { id: heldBy, joined: true };
      }
    }
    tx.set(newOrderRef, draft);
    tx.set(lockRef, { shopId: draft.shopId, tableId, orderId: newOrderRef.id, updatedAt: Date.now() });
    return { id: newOrderRef.id, joined: false };
  });
}
