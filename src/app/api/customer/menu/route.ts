import { NextResponse } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import type { Category, ModifierGroup, ModifierOption, Product, ShopSettings } from "@/types";

/**
 * Public, unauthenticated menu snapshot for the QR self-order screen (`/order/table/[tableId]`).
 * Deliberately routed through the Admin SDK from the server rather than opening `firestore.rules`
 * to public reads — the customer browser never gets a Firestore connection at all, so there's
 * nothing there for a scanner/tamperer to point at directly. Only `active` rows go out; nothing
 * a customer shouldn't see (channel prices, sortOrder internals beyond ordering) is exposed
 * beyond what's needed to render the menu.
 */
export async function GET() {
  const db = getAdminDb();
  const shopId = DEFAULT_SHOP_ID;

  const [categoriesSnap, productsSnap, groupsSnap, optionsSnap, settingsSnap] = await Promise.all([
    db.collection(COLLECTIONS.categories).where("shopId", "==", shopId).where("active", "==", true).get(),
    db.collection(COLLECTIONS.products).where("shopId", "==", shopId).where("active", "==", true).get(),
    db.collection(COLLECTIONS.modifierGroups).where("shopId", "==", shopId).where("active", "==", true).get(),
    db.collection(COLLECTIONS.modifierOptions).where("shopId", "==", shopId).where("active", "==", true).get(),
    db.collection(COLLECTIONS.shopSettings).doc(shopId).get(),
  ]);

  const byId = <T>(docs: FirebaseFirestore.QuerySnapshot) =>
    docs.docs
      .map((d) => ({ ...d.data(), id: d.id }) as T)
      .sort((a, b) => (a as unknown as { sortOrder: number }).sortOrder - (b as unknown as { sortOrder: number }).sortOrder);

  const settings = settingsSnap.exists ? ({ ...settingsSnap.data(), id: settingsSnap.id } as ShopSettings) : null;

  return NextResponse.json({
    categories: byId<Category>(categoriesSnap),
    products: byId<Product>(productsSnap),
    modifierGroups: byId<ModifierGroup>(groupsSnap),
    modifierOptions: byId<ModifierOption>(optionsSnap),
    currency: settings?.currency ?? "THB",
  });
}
