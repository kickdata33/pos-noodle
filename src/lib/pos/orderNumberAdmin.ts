import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import { formatOrderNumber, nextCounterState, type OrderCounterState } from "./orderNumberPure";

/**
 * Admin-SDK counterpart to `orderNumber.ts`'s `generateOrderNumber` — same
 * `orderCounters/{shopId}` doc, same pure rollover logic, but run from a server route (the
 * customer QR-order API) instead of a signed-in staff member's browser, so it goes through
 * `firestore-admin`'s transaction API rather than the client SDK's.
 */
export async function generateOrderNumberAdmin(db: Firestore, shopId: string): Promise<string> {
  const ref = db.collection(COLLECTIONS.orderCounters).doc(shopId);
  const state = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? (snap.data() as OrderCounterState) : null;
    const next = nextCounterState(current, new Date());
    tx.set(ref, next);
    return next;
  });
  return formatOrderNumber(state);
}
