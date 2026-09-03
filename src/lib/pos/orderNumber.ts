import { doc, runTransaction } from "firebase/firestore";

import { db } from "@/lib/firebase/client";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { formatOrderNumber, nextCounterState, type OrderCounterState } from "./orderNumberPure";

export type { OrderCounterState };
export { formatOrderNumber, nextCounterState, todayKey } from "./orderNumberPure";

/**
 * Allocates the next order number for a shop. Runs as a Firestore transaction against
 * `orderCounters/{shopId}` (one doc per shop) so two staff saving a new order at the same
 * moment never collide — Firestore retries the transaction on write conflict automatically.
 */
export async function generateOrderNumber(shopId: string): Promise<string> {
  const ref = doc(db, COLLECTIONS.orderCounters, shopId);
  const state = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? (snap.data() as OrderCounterState) : null;
    const next = nextCounterState(current, new Date());
    tx.set(ref, next);
    return next;
  });
  return formatOrderNumber(state);
}
