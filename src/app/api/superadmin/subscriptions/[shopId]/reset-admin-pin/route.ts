import { NextResponse, type NextRequest } from "next/server";

import { InvalidPinError, PinConflictError, assignPin } from "@/lib/auth/pinAssignment";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { SUPERADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/superadmin/session";
import type { AppUser } from "@/types";

/**
 * Re-issues a shop's admin PIN directly by `shopId` + `uid` — the companion to
 * `/api/superadmin/signup-requests/[id]/reset-admin-pin`, which only works when the originating
 * `shopSignupRequests` doc still has `approvedShopId`/`assignedAdminUid` on it (shops approved
 * before those fields existed, or created any other way — `scripts/seed.ts`, manually in
 * Firestore — have no such doc to look them up from, so that route's "ไม่ได้อนุมัติ" 409 is
 * misleading for them even though the shop and its admin both plainly exist). This route instead
 * takes the shop and user ids straight from `/superadmin/subscriptions`, which lists every real
 * shop from the `shops`/`users` collections directly, not from signup-request leftovers.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ shopId: string }> }) {
  if (!verifySessionToken(request.cookies.get(SUPERADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 401 });
  }

  const { shopId } = await params;
  const body = (await request.json().catch(() => null)) as { uid?: string; pin?: string } | null;
  const uid = body?.uid;
  const pin = body?.pin;
  if (!uid || !pin) return NextResponse.json({ error: "ข้อมูลไม่ครบ" }, { status: 400 });

  const db = getAdminDb();
  const userSnap = await db.collection(COLLECTIONS.users).doc(uid).get();
  if (!userSnap.exists) return NextResponse.json({ error: "ไม่พบผู้ใช้นี้" }, { status: 404 });

  // The caller supplies both `shopId` (URL) and `uid` (body) separately — re-check they actually
  // belong together before touching `userSecrets`, same discipline as `/api/admin/staff/[id]/pin`
  // re-checking `session.appUser.shopId` rather than trusting a shopId from the request. Without
  // this, a typo'd or mismatched pair here would silently (re)assign a PIN under the wrong shopId
  // — exactly the kind of cross-tenant mistake this whole feature exists to let someone recover
  // from, not risk repeating.
  const user = userSnap.data() as AppUser;
  if (user.shopId !== shopId) {
    return NextResponse.json({ error: "ผู้ใช้นี้ไม่ได้อยู่ร้านนี้" }, { status: 409 });
  }

  try {
    await assignPin(db, shopId, uid, pin);
  } catch (error) {
    if (error instanceof PinConflictError || error instanceof InvalidPinError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({ ok: true });
}
