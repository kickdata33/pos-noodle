import { orderBy, where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { Product } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class ProductRepository extends FirestoreRepository<Product> {
  constructor() {
    super(COLLECTIONS.products);
  }

  listForShop(shopId: string): Promise<Product[]> {
    return this.list(where("shopId", "==", shopId), orderBy("sortOrder", "asc"));
  }

  subscribeForShop(shopId: string, onChange: (products: Product[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId), orderBy("sortOrder", "asc"));
  }
}

export const productRepository = new ProductRepository();
