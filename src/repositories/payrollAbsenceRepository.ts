import { where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { PayrollAbsence } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class PayrollAbsenceRepository extends FirestoreRepository<PayrollAbsence> {
  constructor() {
    super(COLLECTIONS.payrollAbsences);
  }

  /** Deterministic id (`${staffId}_${dateKey}`) — same construction as
   * `recurringExpenseSkipRepository.skip`. Marking the same person absent on the same day twice
   * is naturally idempotent. */
  async markAbsent(shopId: string, staffId: string, dateKey: string): Promise<void> {
    await this.create({ shopId, staffId, dateKey, createdAt: Date.now() }, `${staffId}_${dateKey}`);
  }

  /** Undo a mistaken "มาร์กลา" — same id construction as `markAbsent`. */
  async unmarkAbsent(staffId: string, dateKey: string): Promise<void> {
    await this.remove(`${staffId}_${dateKey}`);
  }

  /** Every absence ever recorded for the shop — same small-dataset reasoning as
   * `payrollAdvanceRepository.subscribeForShop`. */
  subscribeForShop(shopId: string, onChange: (absences: PayrollAbsence[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId));
  }
}

export const payrollAbsenceRepository = new PayrollAbsenceRepository();
