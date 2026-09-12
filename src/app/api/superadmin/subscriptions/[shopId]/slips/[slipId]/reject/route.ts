import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { SUPERADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/superadmin/session";

/**
 * Superadmin rejects a shop's bank-transfer slip (SaaS roadmap Phase 3 bank-transfer
 * alternative) — e.g. the amount doesn't match, the image is unreadable, or it looks fraudulent.
 * Only the slip changes; the subscription is left exactly as it was (still `past_due`/
 * `suspended`) since nothing was actually verified as paid — the shop sees the rejection reason
 * on `/billing` and can submit a new slip or pay by card instead.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ shopId: string; slipId: string }> }) {
  if (!verifySessionToken(request.cookies.get(SUPERADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 401 });
  }

  const { shopId, slipId } = await params;
  const body = (await request.json().catch(() => null)) as { reason?: string } | null;
  const reason = body?.reason?.trim() || "ไม่สามารถตรวจสอบสลิปนี้ได้";

  const db = getAdminDb();
  const slipRef = db.collection(COLLECTIONS.paymentSlips).doc(slipId);
  const slipSnap = await slipRef.get();
  if (!slipSnap.exists) return NextResponse.json({ error: "ไม่พบสลิปนี้" }, { status: 404 });
  if (slipSnap.data()?.shopId !== shopId) {
    return NextResponse.json({ error: "สลิปนี้ไม่ตรงกับร้าน" }, { status: 400 });
  }

  await slipRef.update({ status: "rejected", reviewedAt: Date.now(), reviewNote: reason });
  return NextResponse.json({ ok: true });
}
