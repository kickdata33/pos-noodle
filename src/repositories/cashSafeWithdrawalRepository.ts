import { where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { CashSafeWithdrawal } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class CashSafeWithdrawalRepository extends FirestoreRepository<CashSafeWithdrawal> {
  constructor() {
    super(COLLECTIONS.cashSafeWithdrawals);
  }

  /** Same pattern as `cashSafeCountRepository.subscribeForShop` — small, whole-shop-lifetime
   * list, sorted client-side by whoever needs it (latest-first history, or summed for the
   * running total). No `orderBy`, so no composite index needed. */
  subscribeForShop(shopId: string, onChange: (withdrawals: CashSafeWithdrawal[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId));
  }
}

export const cashSafeWithdrawalRepository = new CashSafeWithdrawalRepository();
