import { NextResponse, type NextRequest } from "next/server";

import { chargeSubscription } from "@/lib/billing/chargeSubscription";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { SUPERADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/superadmin/session";
import type { Subscription } from "@/types";

/** Manual override: force an immediate charge attempt outside the daily cron schedule (SaaS
 * roadmap Phase 3) — reuses the exact same `chargeSubscription()` the cron uses, so the
 * success/failure state transitions are identical either way. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ shopId: string }> }) {
  if (!verifySessionToken(request.cookies.get(SUPERADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 401 });
  }

  const { shopId } = await params;
  const db = getAdminDb();
  const snap = await db.collection(COLLECTIONS.subscriptions).doc(shopId).get();
  if (!snap.exists) return NextResponse.json({ error: "ไม่พบร้านนี้" }, { status: 404 });

  const subscription = { id: snap.id, ...(snap.data() as Omit<Subscription, "id">) };
  const result = await chargeSubscription(db, subscription);
  return NextResponse.json(result);
}
