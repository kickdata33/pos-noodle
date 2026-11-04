import { limit, orderBy, where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { StockLevel, StockMovement } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class StockLevelRepository extends FirestoreRepository<StockLevel> {
  constructor() {
    super(COLLECTIONS.stockLevels);
  }

  /** Every tracked item for the shop, sorted by name here (no composite index needed). */
  subscribeForShop(shopId: string, onChange: (levels: StockLevel[]) => void): Unsubscribe {
    return this.subscribe(
      (levels) => onChange(levels.slice().sort((a, b) => a.productName.localeCompare(b.productName, "th"))),
      where("shopId", "==", shopId)
    );
  }
}

class StockMovementRepository extends FirestoreRepository<StockMovement> {
  constructor() {
    super(COLLECTIONS.stockMovements);
  }

  /** Newest first. Needs the `shopId+createdAt` composite index in `firestore.indexes.json`. */
  subscribeRecentForShop(shopId: string, max: number, onChange: (rows: StockMovement[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId), orderBy("createdAt", "desc"), limit(max));
  }
}

export const stockLevelRepository = new StockLevelRepository();
export const stockMovementRepository = new StockMovementRepository();
