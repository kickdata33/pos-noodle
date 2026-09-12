import { NextResponse, type NextRequest } from "next/server";

import { InvalidPinError, PinConflictError, assignPin } from "@/lib/auth/pinAssignment";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { SUPERADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/superadmin/session";
import type { ShopSignupRequest } from "@/types";

/**
 * Re-issues the PIN for the admin account created when this signup request was approved.
 *
 * Exists because a PIN is never stored in plaintext anywhere outside the one-time approval
 * dialog (see `ShopSignupRequest.assignedAdminUid`'s doc comment) — if the superadmin closes
 * that dialog before copying it down to the shop owner, this is the only way to recover: issue
 * a fresh one, not reveal the old one (which nothing on the server can do anyway).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifySessionToken(request.cookies.get(SUPERADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { pin?: string } | null;
  const pin = body?.pin;
  if (!pin) return NextResponse.json({ error: "กรุณากรอก PIN" }, { status: 400 });

  const db = getAdminDb();
  const requestSnap = await db.collection(COLLECTIONS.shopSignupRequests).doc(id).get();
  if (!requestSnap.exists) return NextResponse.json({ error: "ไม่พบคำขอนี้" }, { status: 404 });

  const signupRequest = requestSnap.data() as ShopSignupRequest;
  if (signupRequest.status !== "approved" || !signupRequest.approvedShopId || !signupRequest.assignedAdminUid) {
    return NextResponse.json({ error: "คำขอนี้ยังไม่ได้อนุมัติ" }, { status: 409 });
  }

  try {
    await assignPin(db, signupRequest.approvedShopId, signupRequest.assignedAdminUid, pin);
  } catch (error) {
    if (error instanceof PinConflictError || error instanceof InvalidPinError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({ ok: true });
}
