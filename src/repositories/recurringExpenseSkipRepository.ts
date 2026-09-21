import { where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { RecurringExpenseSkip } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class RecurringExpenseSkipRepository extends FirestoreRepository<RecurringExpenseSkip> {
  constructor() {
    super(COLLECTIONS.recurringExpenseSkips);
  }

  /** Deterministic id (`${recurringExpenseId}_${dateKey}`) — see the type's comment. Plain
   * `create(..., id)` (a `setDoc`, not merge) is fine here since every field is always supplied
   * together; there's nothing to merge. */
  async skip(shopId: string, recurringExpenseId: string, dateKey: string): Promise<void> {
    await this.create(
      { shopId, recurringExpenseId, dateKey, createdAt: Date.now() },
      `${recurringExpenseId}_${dateKey}`
    );
  }

  /** Every skip for the shop — small, whole-shop-lifetime list, filtered client-side by whoever
   * needs a specific template/day (see `computeMissingRecurringExpenses`'s `skippedKeys`). No
   * `orderBy`, same reasoning as `recurringExpenseRepository.subscribeForShop`. */
  subscribeForShop(shopId: string, onChange: (skips: RecurringExpenseSkip[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId));
  }
}

export const recurringExpenseSkipRepository = new RecurringExpenseSkipRepository();
