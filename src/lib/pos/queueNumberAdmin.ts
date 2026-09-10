import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import { nextCounterState, type OrderCounterState } from "./orderNumberPure";

/**
 * Daily pickup-queue number for the self-order takeaway screen ("คิว 12" — see
 * `ShopSettings.pickupIdentificationMode`). Reuses `orderNumberPure`'s daily-reset counter logic
 * (same shape, same rollover rule) against its own `pickupQueueCounters/{shopId}` doc — kept
 * separate from `orderCounters` on purpose, since that counter increments for every order on
 * every channel (dine-in included), which would make queue numbers jump around unpredictably
 * instead of reading as a tight, dense sequence customers can actually listen for. Admin-SDK
 * only: only the anonymous customer pickup-order API route ever calls this, so there's no
 * client-side (`firebase/firestore`) counterpart the way `orderNumber.ts` has one for staff.
 */
export async function generateQueueNumberAdmin(db: Firestore, shopId: string): Promise<number> {
  const ref = db.collection(COLLECTIONS.pickupQueueCounters).doc(shopId);
  const state = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? (snap.data() as OrderCounterState) : null;
    const next = nextCounterState(current, new Date());
    tx.set(ref, next);
    return next;
  });
  return state.seq;
}
