import { orderBy, where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { DeliveryPayout } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class DeliveryPayoutRepository extends FirestoreRepository<DeliveryPayout> {
  constructor() {
    super(COLLECTIONS.deliveryPayouts);
  }

  /** Same pattern as `expenseRepository.subscribeForShop` — newest-first, safe lexicographic
   * sort on a "YYYY-MM-DD" `dateKey`. */
  subscribeForShop(shopId: string, onChange: (payouts: DeliveryPayout[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId), orderBy("dateKey", "desc"));
  }
}

export const deliveryPayoutRepository = new DeliveryPayoutRepository();
