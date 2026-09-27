import { where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { ShopClosedDate } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class ShopClosedDateRepository extends FirestoreRepository<ShopClosedDate> {
  constructor() {
    super(COLLECTIONS.shopClosedDates);
  }

  /** Deterministic id (`${shopId}_${dateKey}`) — see the type's comment. Plain `create(..., id)`
   * (a `setDoc`, not merge) is fine here since every field is always supplied together; there's
   * nothing to merge. Also doubles as "update" — saving over an existing override for the same
   * date just replaces it, which is exactly what the settings UI wants when a note is
   * corrected. */
  async set(override: Omit<ShopClosedDate, "id">): Promise<void> {
    await this.create(override, `${override.shopId}_${override.dateKey}`);
  }

  /** Removes an override for one date, reverting it back to whatever the recurring
   * `closedDaysOfMonth` rule alone says. */
  async clear(shopId: string, dateKey: string): Promise<void> {
    await this.remove(`${shopId}_${dateKey}`);
  }

  /** Every override for the shop — small, whole-shop-lifetime list, filtered client-side by
   * whoever needs a specific range (see `shopCalendar.ts`'s `closedDateKeysInRange`). No
   * `orderBy`, same reasoning as `recurringExpenseSkipRepository.subscribeForShop`. */
  subscribeForShop(shopId: string, onChange: (overrides: ShopClosedDate[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId));
  }
}

export const shopClosedDateRepository = new ShopClosedDateRepository();
