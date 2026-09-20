import { doc, orderBy, setDoc, where, type Unsubscribe } from "firebase/firestore";

import { db } from "@/lib/firebase/client";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { DailyFloat } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

/** One doc per shop per business day — a compound, deterministic id instead of an auto-generated
 * one, so "enter today's starting cash" is always a single upsert against a known doc rather than
 * a query-then-create-or-update dance. */
function floatDocId(shopId: string, businessDayKey: string): string {
  return `${shopId}_${businessDayKey}`;
}

class DailyFloatRepository extends FirestoreRepository<DailyFloat> {
  constructor() {
    super(COLLECTIONS.dailyFloats);
  }

  subscribeForShop(shopId: string, onChange: (floats: DailyFloat[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId), orderBy("businessDayKey", "desc"));
  }

  /** Always a merge-write, never create-then-update — either `startingCash`,
   * `startingKshopBalance`, or `kshopCheckedBalance` can be the first field ever entered for a
   * given business day, in any order, so there's no single "this doc now exists" moment to hang
   * a create/update split on. */
  async upsert(
    shopId: string,
    businessDayKey: string,
    patch: Partial<Omit<DailyFloat, "id" | "shopId" | "businessDayKey">>
  ): Promise<void> {
    await setDoc(doc(db, COLLECTIONS.dailyFloats, floatDocId(shopId, businessDayKey)), { shopId, businessDayKey, ...patch }, { merge: true });
  }
}

export const dailyFloatRepository = new DailyFloatRepository();
