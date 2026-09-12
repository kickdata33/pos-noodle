import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { SUPERADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/superadmin/session";
import type { Subscription } from "@/types";

/** Manual override: restore a suspended shop's access (SaaS roadmap Phase 3) without going
 * through `/billing` — returns to `trialing` if the trial period hasn't technically ended yet,
 * otherwise `active` (matches the same status choice `/api/billing/card` makes on recovery). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ shopId: string }> }) {
  if (!verifySessionToken(request.cookies.get(SUPERADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 401 });
  }

  const { shopId } = await params;
  const now = Date.now();
  const ref = getAdminDb().collection(COLLECTIONS.subscriptions).doc(shopId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "ไม่พบร้านนี้" }, { status: 404 });
  const subscription = snap.data() as Subscription;

  await ref.update({
    status: subscription.trialEndsAt > now ? "trialing" : "active",
    graceEndsAt: null,
    lastChargeError: null,
    updatedAt: now,
  });
  return NextResponse.json({ ok: true });
}
