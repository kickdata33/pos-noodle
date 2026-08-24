import { orderBy, where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { PaymentMethod } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class PaymentMethodRepository extends FirestoreRepository<PaymentMethod> {
  constructor() {
    super(COLLECTIONS.paymentMethods);
  }

  listForShop(shopId: string): Promise<PaymentMethod[]> {
    return this.list(where("shopId", "==", shopId), orderBy("sortOrder", "asc"));
  }

  subscribeForShop(shopId: string, onChange: (methods: PaymentMethod[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId), orderBy("sortOrder", "asc"));
  }
}

export const paymentMethodRepository = new PaymentMethodRepository();
