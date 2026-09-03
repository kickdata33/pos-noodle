import { orderBy, where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { Order } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

/**
 * `create`/`update` from the base class cover the whole order lifecycle (open, add items,
 * checkout) — this repository only adds the shop-scoped queries the POS screens need.
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

  /**
   * Open orders that aren't tied to a table — a saved-but-unpaid Grab/takeaway order, so it
   * isn't lost once staff navigate away from the order screen (item 7 "กลับมาเปิด Order เดิมได้"
   * applies to every channel, not just dine-in). Filtered client-side over the same open-orders
   * query above rather than a second Firestore query, since `tableId == null` combined with the
   * existing `status == "OPEN"` filter would need its own composite index for no real benefit
   * at this shop's scale.
   */
  subscribeOpenNonTableForShop(shopId: string, onChange: (orders: Order[]) => void): Unsubscribe {
    return this.subscribeOpenForShop(shopId, (orders) =>
      onChange(orders.filter((o) => o.tableId === null))
    );
  }

  listForShop(shopId: string): Promise<Order[]> {
    return this.list(where("shopId", "==", shopId), orderBy("createdAt", "desc"));
  }
}

export const orderRepository = new OrderRepository();
