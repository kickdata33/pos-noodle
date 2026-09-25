import { orderBy, where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { DeliveryFloatTopUp } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class DeliveryFloatTopUpRepository extends FirestoreRepository<DeliveryFloatTopUp> {
  constructor() {
    super(COLLECTIONS.deliveryFloatTopUps);
  }

  subscribeForShop(shopId: string, onChange: (topUps: DeliveryFloatTopUp[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId), orderBy("dateKey", "desc"));
  }
}

export const deliveryFloatTopUpRepository = new DeliveryFloatTopUpRepository();
