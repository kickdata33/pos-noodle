import { orderBy, where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { ModifierGroup, ModifierOption } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class ModifierGroupRepository extends FirestoreRepository<ModifierGroup> {
  constructor() {
    super(COLLECTIONS.modifierGroups);
  }

  listForShop(shopId: string): Promise<ModifierGroup[]> {
    return this.list(where("shopId", "==", shopId), orderBy("sortOrder", "asc"));
  }

  subscribeForShop(shopId: string, onChange: (groups: ModifierGroup[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId), orderBy("sortOrder", "asc"));
  }
}

class ModifierOptionRepository extends FirestoreRepository<ModifierOption> {
  constructor() {
    super(COLLECTIONS.modifierOptions);
  }

  listForGroup(groupId: string): Promise<ModifierOption[]> {
    return this.list(where("groupId", "==", groupId), orderBy("sortOrder", "asc"));
  }

  subscribeForGroup(groupId: string, onChange: (options: ModifierOption[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("groupId", "==", groupId), orderBy("sortOrder", "asc"));
  }

  /**
   * Every option for every group at once, for screens (the POS order screen) that need to look
   * options up by groupId client-side rather than opening one subscription per group — a shop
   * has a handful of modifier groups total, so this stays a small read either way.
   */
  subscribeForShop(shopId: string, onChange: (options: ModifierOption[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId), orderBy("sortOrder", "asc"));
  }
}

export const modifierGroupRepository = new ModifierGroupRepository();
export const modifierOptionRepository = new ModifierOptionRepository();
