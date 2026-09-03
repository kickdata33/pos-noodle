import { orderBy, where } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { Payment } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

/** Append-only — `firestore.rules` denies update/delete on `payments` entirely. */
class PaymentRepository extends FirestoreRepository<Payment> {
  constructor() {
    super(COLLECTIONS.payments);
  }

  listForShop(shopId: string): Promise<Payment[]> {
    return this.list(where("shopId", "==", shopId), orderBy("createdAt", "desc"));
  }
}

export const paymentRepository = new PaymentRepository();
