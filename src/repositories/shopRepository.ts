import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

import { db } from "@/lib/firebase/client";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { Shop, ShopSettings } from "@/types";

/**
 * `shops` and `shopSettings` are singleton-per-shop docs (not a list a component ever paginates),
 * so this repository skips the generic `FirestoreRepository` list/subscribe surface and just
 * exposes get/update by shopId.
 */
class ShopRepository {
  async getShop(shopId: string): Promise<Shop | null> {
    const snap = await getDoc(doc(db, COLLECTIONS.shops, shopId));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as Shop) : null;
  }

  async getSettings(shopId: string): Promise<ShopSettings | null> {
    const snap = await getDoc(doc(db, COLLECTIONS.shopSettings, shopId));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as ShopSettings) : null;
  }

  async setSettings(shopId: string, data: Omit<ShopSettings, "id">): Promise<void> {
    await setDoc(doc(db, COLLECTIONS.shopSettings, shopId), data);
  }

  async updateSettings(shopId: string, data: Partial<Omit<ShopSettings, "id">>): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.shopSettings, shopId), data);
  }
}

export const shopRepository = new ShopRepository();
