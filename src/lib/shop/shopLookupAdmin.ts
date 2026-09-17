import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import type { Shop } from "@/types";

/** Header `src/proxy.ts` sets from the request's Host — pure string parsing there, this is the
 * Node-runtime half that actually hits Firestore (SaaS roadmap Phase 2). */
export const SHOP_SLUG_HEADER = "x-shop-slug";

export async function getShopBySlug(db: Firestore, slug: string): Promise<Shop | null> {
  const snap = await db.collection(COLLECTIONS.shops).where("slug", "==", slug).limit(1).get();
  if (snap.empty) return null;
  return { ...(snap.docs[0].data() as Omit<Shop, "id">), id: snap.docs[0].id };
}

// A shop's slug practically never changes after it's provisioned (it's set once at approval —
// see the superadmin approve route), so caching slug→shopId in the warm serverless instance's
// memory for a few minutes is safe and skips a Firestore round trip on every single PIN login,
// which was one of a handful of sequential reads making `/api/auth/pin` feel slow (reported by
// the shop owner: "ใส่รหัส PIN โหลดนานไปหน่อย"). A cold invocation still pays for the real query
// once; every login on the same warm instance afterward reads from memory instead. `null` is
// cached too (a mistyped/stale subdomain), so repeated probes of a non-existent slug don't keep
// hitting Firestore either.
const SLUG_CACHE_TTL_MS = 5 * 60 * 1000;
const shopIdBySlugCache = new Map<string, { shopId: string | null; expiresAt: number }>();

/**
 * Resolves the `shopId` a request is for, given the `x-shop-slug` header `proxy.ts` sets from
 * the Host. Three outcomes, deliberately distinct:
 * - no header at all → the apex/root domain (or localhost, or a Vercel preview) → today's
 *   single-shop behavior, `DEFAULT_SHOP_ID`, unchanged.
 * - header present but no shop has that slug → `null`. Callers must treat this as "shop not
 *   found" (404), never silently fall back to `DEFAULT_SHOP_ID` — that would leak the real
 *   shop's data onto a mistyped/stale subdomain.
 * - header present and matched → that shop's real id.
 */
export async function resolveShopIdFromHost(
  db: Firestore,
  headers: Pick<Headers, "get">
): Promise<string | null> {
  const slug = headers.get(SHOP_SLUG_HEADER);
  if (!slug) return DEFAULT_SHOP_ID;

  const cached = shopIdBySlugCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.shopId;

  const shop = await getShopBySlug(db, slug);
  const shopId = shop?.id ?? null;
  shopIdBySlugCache.set(slug, { shopId, expiresAt: Date.now() + SLUG_CACHE_TTL_MS });
  return shopId;
}
