import { orderBy, where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { Table } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class TableRepository extends FirestoreRepository<Table> {
  constructor() {
    super(COLLECTIONS.tables);
  }

  listForShop(shopId: string): Promise<Table[]> {
    return this.list(where("shopId", "==", shopId), orderBy("sortOrder", "asc"));
  }

  subscribeForShop(shopId: string, onChange: (tables: Table[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId), orderBy("sortOrder", "asc"));
  }
}

export const tableRepository = new TableRepository();
