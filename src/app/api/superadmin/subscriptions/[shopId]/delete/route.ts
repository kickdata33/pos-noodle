import { NextResponse, type NextRequest } from "next/server";

import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { SUPERADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/superadmin/session";
import type { ShopSignupRequest } from "@/types";

/** Collections keyed by a `shopId` field (queried and bulk-deleted) — every collection in
 * `COLLECTIONS` that actually carries a shop's operational data. Deliberately excludes
 * `billingConfig` (a global singleton, not per-shop), `pinAttempts` (keyed by hashed IP, not
 * shopId), and `customerOrderThrottle` (keyed by tableId — its docs expire in relevance after
 * 5 seconds regardless, see `lib/pos/customerThrottle.ts`, so leftover orphans are harmless and
 * not worth the extra query). */
const SHOP_SCOPED_COLLECTIONS = [
  COLLECTIONS.tables,
  COLLECTIONS.categories,
  COLLECTIONS.products,
  COLLECTIONS.modifierGroups,
  COLLECTIONS.modifierOptions,
  COLLECTIONS.salesChannels,
  COLLECTIONS.paymentMethods,
  COLLECTIONS.orders,
  COLLECTIONS.payments,
  COLLECTIONS.auditLogs,
  COLLECTIONS.paymentSlips,
] as const;

/** Collections where the doc id itself is the shopId. */
const SHOP_ID_DOC_COLLECTIONS = [
  COLLECTIONS.shopSettings,
  COLLECTIONS.orderCounters,
  COLLECTIONS.pickupQueueCounters,
  COLLECTIONS.subscriptions,
] as const;

/**
 * Permanently deletes a shop and everything under it — requested for cases like a repeat
 * free-trial abuser, not a routine action (the console gates this behind a strong confirm; see
 * `SubscriptionsConsole`). Irreversible: no soft-delete/undo anywhere in this flow.
 *
 * Order matters: Firebase Auth users first (so a half-deleted shop can never leave a login that
 * still works), then every Firestore collection scoped to this shop, then the `shops` doc
 * itself last (so a crash partway through never leaves the shop "existing" with orphaned data
 * — worst case it leaves orphaned data with no shop, which a re-run of this same route cleans
 * up fully since every query here is by shopId, not by assuming the shop doc still exists).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ shopId: string }> }) {
  if (!verifySessionToken(request.cookies.get(SUPERADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 401 });
  }

  const { shopId } = await params;
  const db = getAdminDb();
  const auth = getAdminAuth();

  const shopSnap = await db.collection(COLLECTIONS.shops).doc(shopId).get();
  if (!shopSnap.exists) return NextResponse.json({ error: "ไม่พบร้านนี้" }, { status: 404 });

  // 1. Delete every Firebase Auth account belonging to this shop's staff/admin users.
  const usersSnap = await db.collection(COLLECTIONS.users).where("shopId", "==", shopId).get();
  for (const userDoc of usersSnap.docs) {
    await auth.deleteUser(userDoc.id).catch(() => {
      // Already gone, or never had a real Auth account — either way, safe to continue.
    });
  }

  // 2. Bulk-delete every shop-scoped Firestore collection (users + userSecrets included).
  const writer = db.bulkWriter();
  for (const collection of [...SHOP_SCOPED_COLLECTIONS, COLLECTIONS.users, COLLECTIONS.userSecrets]) {
    const snap = await db.collection(collection).where("shopId", "==", shopId).get();
    for (const doc of snap.docs) writer.delete(doc.ref);
  }
  for (const collection of SHOP_ID_DOC_COLLECTIONS) {
    writer.delete(db.collection(collection).doc(shopId));
  }
  await writer.close();

  // 3. The shop doc itself, last.
  await db.collection(COLLECTIONS.shops).doc(shopId).delete();

  // 4. Un-link the signup request that created this shop (if any) so the console doesn't show
  // a dead "ลิงก์ร้าน" pointing at a shop that no longer exists — its slug becomes available
  // again for a future signup.
  const requestSnap = await db
    .collection(COLLECTIONS.shopSignupRequests)
    .where("approvedShopId", "==", shopId)
    .limit(1)
    .get();
  if (!requestSnap.empty) {
    const req = requestSnap.docs[0].data() as ShopSignupRequest;
    await requestSnap.docs[0].ref.update({
      status: "rejected",
      approvedShopId: null,
      finalSlug: null,
      assignedAdminUid: null,
      rejectionReason: req.rejectionReason ?? "ลบร้านออกจากระบบถาวรแล้ว",
    });
  }

  return NextResponse.json({ ok: true });
}
