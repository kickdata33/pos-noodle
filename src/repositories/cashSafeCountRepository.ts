import { where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { CashSafeCount } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class CashSafeCountRepository extends FirestoreRepository<CashSafeCount> {
  constructor() {
    super(COLLECTIONS.cashSafeCounts);
  }

  /** Every count entry for the shop — small, whole-shop-lifetime list, sorted client-side by
   * whoever needs "the latest one" (`/admin/cash-safe`) or a chronological history. No
   * `orderBy`, same reasoning as `deliveryPayoutRepository`'s plain-`dateKey` collections that
   * don't need a composite index. */
  subscribeForShop(shopId: string, onChange: (counts: CashSafeCount[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId));
  }
}

export const cashSafeCountRepository = new CashSafeCountRepository();
