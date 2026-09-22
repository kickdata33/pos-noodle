import { where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { PayrollSettlement } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class PayrollSettlementRepository extends FirestoreRepository<PayrollSettlement> {
  constructor() {
    super(COLLECTIONS.payrollSettlements);
  }

  /** Every settlement ever recorded for the shop, newest history first is sorted client-side —
   * this is also how `/admin/payroll` finds each employee's most recent `periodEnd` to derive
   * their current period's start (`computeCurrentPeriodStart`). */
  subscribeForShop(shopId: string, onChange: (settlements: PayrollSettlement[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId));
  }
}

export const payrollSettlementRepository = new PayrollSettlementRepository();
