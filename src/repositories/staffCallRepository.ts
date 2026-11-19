import { doc, runTransaction, where, type Unsubscribe } from "firebase/firestore";

import { db } from "@/lib/firebase/client";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { AppUser, StaffCall } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class StaffCallRepository extends FirestoreRepository<StaffCall> {
  constructor() {
    super(COLLECTIONS.staffCalls);
  }

  /** Calls nobody has resolved yet, oldest first. Equality filters only — no index needed, same
   * as `serveCallRepository.subscribeOpen`. */
  subscribeOpen(shopId: string, onChange: (calls: StaffCall[]) => void): Unsubscribe {
    return this.subscribe(
      (calls) => onChange(calls.slice().sort((a, b) => a.createdAt - b.createdAt)),
      where("shopId", "==", shopId),
      where("resolvedAt", "==", null)
    );
  }

  /** First tap wins; a second phone resolving a moment later changes nothing — mirrors
   * `serveCallRepository.acknowledge`. Returns true only for the tap that actually resolved it. */
  async resolve(callId: string, by: Pick<AppUser, "id" | "name">): Promise<boolean> {
    const ref = doc(db, COLLECTIONS.staffCalls, callId);
    return runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists() || snap.data().resolvedAt) return false;
      tx.update(ref, { resolvedAt: Date.now(), resolvedById: by.id, resolvedByName: by.name });
      return true;
    });
  }
}

export const staffCallRepository = new StaffCallRepository();
