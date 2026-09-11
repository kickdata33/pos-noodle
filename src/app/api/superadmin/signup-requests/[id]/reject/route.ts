import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { SUPERADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/superadmin/session";
import type { ShopSignupRequest } from "@/types";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifySessionToken(request.cookies.get(SUPERADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { reason?: string } | null;
  const reason = body?.reason?.trim() || null;

  const db = getAdminDb();
  const requestRef = db.collection(COLLECTIONS.shopSignupRequests).doc(id);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    return NextResponse.json({ error: "ไม่พบคำขอนี้" }, { status: 404 });
  }
  const signupRequest = requestSnap.data() as ShopSignupRequest;
  if (signupRequest.status !== "pending") {
    return NextResponse.json({ error: "คำขอนี้ถูกดำเนินการไปแล้ว" }, { status: 409 });
  }

  await requestRef.update({ status: "rejected", reviewedAt: Date.now(), rejectionReason: reason });
  return NextResponse.json({ ok: true });
}
