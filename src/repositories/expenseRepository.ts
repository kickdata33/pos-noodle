import { orderBy, where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { Expense } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class ExpenseRepository extends FirestoreRepository<Expense> {
  constructor() {
    super(COLLECTIONS.expenses);
  }

  /** Newest-first list for the accounting page — matches `dateKey` (a plain string), so this
   * sorts lexicographically, which is safe for "YYYY-MM-DD" keys. */
  subscribeForShop(shopId: string, onChange: (expenses: Expense[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId), orderBy("dateKey", "desc"));
  }

  /** Same idea as `orderRepository.listPaidForShopInRange` — the accounting page's date-range
   * picker only needs expenses inside the visible range, not the shop's whole history. */
  listForShopInRange(shopId: string, startKey: string, endKey: string): Promise<Expense[]> {
    return this.list(
      where("shopId", "==", shopId),
      where("dateKey", ">=", startKey),
      where("dateKey", "<=", endKey),
      orderBy("dateKey", "desc")
    );
  }
}

export const expenseRepository = new ExpenseRepository();
