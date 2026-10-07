import { orderBy, where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { InvestmentItem } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class InvestmentRepository extends FirestoreRepository<InvestmentItem> {
  constructor() {
    super(COLLECTIONS.investments);
  }

  /** Same pattern as `expenseRepository.subscribeForShop` — newest-first, safe lexicographic
   * sort on a "YYYY-MM-DD" `dateKey`. Always the shop's whole history (never range-limited): the
   * list is usually short (a handful to a few dozen items over the shop's lifetime), and the
   * investment-summary page needs every row anyway to compute "ยอดลงทุนรวม". */
  subscribeForShop(shopId: string, onChange: (items: InvestmentItem[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId), orderBy("dateKey", "desc"));
  }
}

export const investmentRepository = new InvestmentRepository();
