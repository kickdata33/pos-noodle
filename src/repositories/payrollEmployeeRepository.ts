import { where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { PayrollEmployee } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class PayrollEmployeeRepository extends FirestoreRepository<PayrollEmployee> {
  constructor() {
    super(COLLECTIONS.payrollEmployees);
  }

  /** Deterministic id (`= staffId`) — see the type's comment. A staff member can only ever be
   * enrolled once, so this is always a fresh `setDoc`, never a merge. */
  async enroll(data: Omit<PayrollEmployee, "id">): Promise<void> {
    await this.create(data, data.staffId);
  }

  /** No `orderBy` — small, whole-shop list, sorted client-side, same reasoning as
   * `recurringExpenseRepository.subscribeForShop`. */
  subscribeForShop(shopId: string, onChange: (employees: PayrollEmployee[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId));
  }
}

export const payrollEmployeeRepository = new PayrollEmployeeRepository();
