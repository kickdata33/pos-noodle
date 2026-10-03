import "server-only";

import { headers } from "next/headers";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { SHOP_SLUG_HEADER, resolveShopIdFromHost } from "@/lib/shop/shopLookupAdmin";

/**
 * This shop's own name, for the browser-tab title and the installed-PWA name (root
 * `generateMetadata` and `app/manifest.ts`) — SaaS roadmap: "ทำให้เป็นกลางสำหรับร้านทั่วไป".
 * Before this, both were hardcoded to the original shop's name/business ("POS ร้านก๋วยเตี๋ยว"),
 * which showed for literally every tenant's subdomain, coffee shop or not.
 *
 * Returns `null` — meaning "use the generic RanPOS brand, not a specific shop's name" — in two
 * deliberately different cases:
 * - No `x-shop-slug` header at all: the apex domain, a Vercel preview, or localhost. This is
 *   where the platform's own marketing/landing page lives (`src/app/page.tsx`), so it must never
 *   show one particular shop's name — not even the original shop's, even though `proxy.ts`
 *   treats "no header" as that shop's `DEFAULT_SHOP_ID` for routing purposes. Metadata and
 *   routing are allowed to disagree here on purpose.
 * - Header present but doesn't resolve to a real shop (typo'd/stale subdomain): that request is
 *   heading for a 404 anyway, so the generic brand is a perfectly fine title for it too.
 */
export async function resolveShopNameForMetadata(): Promise<string | null> {
  const headerList = await headers();
  if (!headerList.get(SHOP_SLUG_HEADER)) return null;

  const db = getAdminDb();
  const shopId = await resolveShopIdFromHost(db, headerList);
  if (!shopId) return null;

  const snap = await db.collection(COLLECTIONS.shops).doc(shopId).get();
  const name = (snap.data() as { name?: string } | undefined)?.name;
  return name?.trim() || null;
}
