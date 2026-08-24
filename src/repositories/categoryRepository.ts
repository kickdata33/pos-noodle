import { orderBy, where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { Category } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class CategoryRepository extends FirestoreRepository<Category> {
  constructor() {
    super(COLLECTIONS.categories);
  }

  listForShop(shopId: string): Promise<Category[]> {
    return this.list(where("shopId", "==", shopId), orderBy("sortOrder", "asc"));
  }

  subscribeForShop(shopId: string, onChange: (categories: Category[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId), orderBy("sortOrder", "asc"));
  }
}

export const categoryRepository = new CategoryRepository();
