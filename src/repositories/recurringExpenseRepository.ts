import { where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { RecurringExpense } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class RecurringExpenseRepository extends FirestoreRepository<RecurringExpense> {
  constructor() {
    super(COLLECTIONS.recurringExpenses);
  }

  /** No `orderBy` (avoids needing a composite index for a single small per-shop list) — the
   * accounting page's own "รายจ่ายประจำ" section sorts client-side. */
  subscribeForShop(shopId: string, onChange: (templates: RecurringExpense[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId));
  }
}

export const recurringExpenseRepository = new RecurringExpenseRepository();
