import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { SUPERADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/superadmin/session";
import type { Subscription } from "@/types";

/** Manual override: bump a shop's `trialEndsAt` by N days (SaaS roadmap Phase 3), for support
 * edge cases (e.g. onboarding delay, goodwill extension). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ shopId: string }> }) {
  if (!verifySessionToken(request.cookies.get(SUPERADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 401 });
  }

  const { shopId } = await params;
  const body = (await request.json().catch(() => null)) as { days?: number } | null;
  const days = body?.days;
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) {
    return NextResponse.json({ error: "จำนวนวันไม่ถูกต้อง" }, { status: 400 });
  }

  const db = getAdminDb();
  const ref = db.collection(COLLECTIONS.subscriptions).doc(shopId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "ไม่พบร้านนี้" }, { status: 404 });
  const subscription = snap.data() as Subscription;

  await ref.update({
    trialEndsAt: subscription.trialEndsAt + days * 24 * 60 * 60 * 1000,
    status: subscription.status === "suspended" ? "trialing" : subscription.status,
    updatedAt: Date.now(),
  });
  return NextResponse.json({ ok: true });
}
