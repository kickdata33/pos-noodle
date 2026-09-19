import { orderBy, where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { BankTransfer } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class BankTransferRepository extends FirestoreRepository<BankTransfer> {
  constructor() {
    super(COLLECTIONS.bankTransfers);
  }

  subscribeForShop(shopId: string, onChange: (transfers: BankTransfer[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId), orderBy("transferredAt", "desc"));
  }

  /** Same idea as `expenseRepository.listForShopInRange` — only the transfers inside the
   * accounting page's visible date range, not the shop's whole history. `startMs`/`endMs` should
   * be padded a bit wider than the visible range since a transfer settling a business day near
   * the range's edge can land just outside it — see `lib/pos/reconciliation.ts`. */
  listForShopInRange(shopId: string, startMs: number, endMs: number): Promise<BankTransfer[]> {
    return this.list(
      where("shopId", "==", shopId),
      where("transferredAt", ">=", startMs),
      where("transferredAt", "<=", endMs),
      orderBy("transferredAt", "desc")
    );
  }
}

export const bankTransferRepository = new BankTransferRepository();
