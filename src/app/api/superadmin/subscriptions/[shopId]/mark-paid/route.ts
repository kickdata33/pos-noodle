import { NextResponse, type NextRequest } from "next/server";

import { nextMonthlyBillingDate } from "@/lib/billing/subscriptionState";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { SUPERADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/superadmin/session";

/** Manual override: mark a shop as paid outside the normal Omise flow (SaaS roadmap Phase 3) —
 * e.g. a bank-transfer workaround or a goodwill gesture. Sets active and advances the next
 * billing date by one month from now, clearing any grace/error state. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ shopId: string }> }) {
  if (!verifySessionToken(request.cookies.get(SUPERADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 401 });
  }

  const { shopId } = await params;
  const now = Date.now();
  const ref = getAdminDb().collection(COLLECTIONS.subscriptions).doc(shopId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "ไม่พบร้านนี้" }, { status: 404 });

  await ref.update({
    status: "active",
    nextBillingDate: nextMonthlyBillingDate(now),
    lastChargeStatus: "succeeded",
    lastChargeAt: now,
    lastChargeError: null,
    graceEndsAt: null,
    updatedAt: now,
  });
  return NextResponse.json({ ok: true });
}
