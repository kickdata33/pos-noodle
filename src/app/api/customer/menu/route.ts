import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { resolveShopIdFromHost } from "@/lib/shop/shopLookupAdmin";
import type { Category, ModifierGroup, ModifierOption, Product, ShopSettings } from "@/types";

/**
 * Public, unauthenticated menu snapshot for the QR self-order screen (`/order/table/[tableId]`).
 * Deliberately routed through the Admin SDK from the server rather than opening `firestore.rules`
 * to public reads — the customer browser never gets a Firestore connection at all, so there's
 * nothing there for a scanner/tamperer to point at directly.
 *
 * Categories and modifier *groups* still go out `active`-only — those are an Admin-level
 * on/off switch for a whole section of the menu, not something a customer needs to be told
 * apart from "not on the menu". Products and modifier *options*, though, go out regardless of
 * `active`: that flag is also the staff "ของหมด" (sold out) toggle (`/pos/stock`), and a sold-out
 * item disappearing from the menu entirely reads to a customer as "not sold here" rather than
 * "sold out today" — the shop's whole point in asking for this was that customers should still
 * see it, just marked unavailable. `CustomerOrderScreen` is what turns `active: false` into a
 * disabled "ของหมด" row; nothing a customer shouldn't see (channel prices, sortOrder internals
 * beyond ordering) is exposed either way.
 */
export async function GET(request: NextRequest) {
  const db = getAdminDb();
  // Called as a bare `fetch("/api/customer/menu")` with no params — the shop is resolved from
  // the request's own Host header instead (SaaS roadmap Phase 2, `src/proxy.ts` +
  // `resolveShopIdFromHost`), same as `/api/auth/pin` now does.
  const shopId = await resolveShopIdFromHost(db, request.headers);
  if (!shopId) {
    return NextResponse.json({ error: "ไม่พบร้านนี้" }, { status: 404 });
  }

  const [categoriesSnap, productsSnap, groupsSnap, optionsSnap, settingsSnap] = await Promise.all([
    db.collection(COLLECTIONS.categories).where("shopId", "==", shopId).where("active", "==", true).get(),
    db.collection(COLLECTIONS.products).where("shopId", "==", shopId).get(),
    db.collection(COLLECTIONS.modifierGroups).where("shopId", "==", shopId).where("active", "==", true).get(),
    db.collection(COLLECTIONS.modifierOptions).where("shopId", "==", shopId).get(),
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
    // Shared with `/order/pickup` (the takeaway self-order screen) as well as the dine-in one —
    // harmless extra fields for a consumer that doesn't need them, avoids a whole second
    // near-identical menu endpoint for one more screen.
    promptPayAvailable: Boolean(settings?.promptPayId),
    pickupIdentificationMode: settings?.pickupIdentificationMode ?? "queue",
  });
}
