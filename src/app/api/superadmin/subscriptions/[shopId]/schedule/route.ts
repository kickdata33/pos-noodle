import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { SUPERADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/superadmin/session";

interface RequestBody {
  scheduledSuspendAt?: number | null;
  scheduledReactivateAt?: number | null;
}

/**
 * Sets or clears the two superadmin-scheduled dates a shop's subscription can carry (requested
 * for abuse cases — e.g. "let this one keep its free trial until a specific date, then cut it
 * off automatically" instead of the superadmin having to remember to come back). Only writes the
 * fields present in the body, so the console can set one without touching the other. The daily
 * cron (`runBillingCron`) is what actually acts on these once their date arrives.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ shopId: string }> }) {
  if (!verifySessionToken(request.cookies.get(SUPERADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 401 });
  }

  const { shopId } = await params;
  const body = (await request.json().catch(() => null)) as RequestBody | null;
  if (!body || (body.scheduledSuspendAt === undefined && body.scheduledReactivateAt === undefined)) {
    return NextResponse.json({ error: "ไม่มีข้อมูลให้ตั้งค่า" }, { status: 400 });
  }

  const ref = getAdminDb().collection(COLLECTIONS.subscriptions).doc(shopId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "ไม่พบร้านนี้" }, { status: 404 });

  const update: Record<string, unknown> = { updatedAt: Date.now() };
  if (body.scheduledSuspendAt !== undefined) update.scheduledSuspendAt = body.scheduledSuspendAt;
  if (body.scheduledReactivateAt !== undefined) update.scheduledReactivateAt = body.scheduledReactivateAt;

  await ref.update(update);
  return NextResponse.json({ ok: true });
}
