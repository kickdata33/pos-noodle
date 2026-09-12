import { NextResponse, type NextRequest } from "next/server";

import { nextMonthlyBillingDate } from "@/lib/billing/subscriptionState";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { SUPERADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/superadmin/session";
import type { Subscription } from "@/types";

/**
 * Superadmin approves a shop's bank-transfer slip (SaaS roadmap Phase 3 bank-transfer
 * alternative — confirmed with the user: a human looks at every slip, no auto-verify). Marks
 * the slip `approved` and the subscription paid in the same write pattern as the existing
 * "mark-paid" override (`/api/superadmin/subscriptions/[shopId]/mark-paid`) — active, next
 * billing date one month out, grace/error cleared.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ shopId: string; slipId: string }> }) {
  if (!verifySessionToken(request.cookies.get(SUPERADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 401 });
  }

  const { shopId, slipId } = await params;
  const db = getAdminDb();
  const slipRef = db.collection(COLLECTIONS.paymentSlips).doc(slipId);
  const subRef = db.collection(COLLECTIONS.subscriptions).doc(shopId);
  const [slipSnap, subSnap] = await Promise.all([slipRef.get(), subRef.get()]);
  if (!slipSnap.exists) return NextResponse.json({ error: "ไม่พบสลิปนี้" }, { status: 404 });
  if (!subSnap.exists) return NextResponse.json({ error: "ไม่พบร้านนี้" }, { status: 404 });
  if (slipSnap.data()?.shopId !== shopId) {
    return NextResponse.json({ error: "สลิปนี้ไม่ตรงกับร้าน" }, { status: 400 });
  }

  const now = Date.now();
  const subscription = { id: subSnap.id, ...(subSnap.data() as Omit<Subscription, "id">) };
  await Promise.all([
    slipRef.update({ status: "approved", reviewedAt: now, reviewNote: null }),
    subRef.update({
      status: "active",
      nextBillingDate: nextMonthlyBillingDate(subscription.nextBillingDate ?? now),
      lastChargeStatus: "succeeded",
      lastChargeAt: now,
      lastChargeError: null,
      graceEndsAt: null,
      updatedAt: now,
    }),
  ]);
  return NextResponse.json({ ok: true });
}
