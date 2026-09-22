import { where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { PayrollAdvance } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class PayrollAdvanceRepository extends FirestoreRepository<PayrollAdvance> {
  constructor() {
    super(COLLECTIONS.payrollAdvances);
  }

  /** Every advance ever recorded for the shop — small dataset for a couple of employees, so no
   * date-range filtering server-side; `/admin/payroll` narrows to "this employee's current
   * period" client-side, same pattern as `recurringExpenseSkipRepository.subscribeForShop`. */
  subscribeForShop(shopId: string, onChange: (advances: PayrollAdvance[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId));
  }
}

export const payrollAdvanceRepository = new PayrollAdvanceRepository();
