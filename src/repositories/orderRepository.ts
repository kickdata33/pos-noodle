import { orderBy, where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { Order } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

/**
 * Full order CRUD (create/checkout/reopen table etc.) lands with the POS-screen milestone;
 * this milestone only needs enough surface for later services to build on.
 */
class OrderRepository extends FirestoreRepository<Order> {
  constructor() {
    super(COLLECTIONS.orders);
  }

  /** Open orders for a shop — drives the "table has a running bill" view on the POS home screen. */
  subscribeOpenForShop(shopId: string, onChange: (orders: Order[]) => void): Unsubscribe {
    return this.subscribe(
      onChange,
      where("shopId", "==", shopId),
      where("status", "==", "OPEN")
    );
  }

  listForShop(shopId: string): Promise<Order[]> {
    return this.list(where("shopId", "==", shopId), orderBy("createdAt", "desc"));
  }
}

export const orderRepository = new OrderRepository();
