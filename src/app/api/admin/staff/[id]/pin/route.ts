import { NextResponse, type NextRequest } from "next/server";

import { getServerSession } from "@/lib/auth/session";
import { InvalidPinError, PinConflictError, assignPin } from "@/lib/auth/pinAssignment";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";

/** Reset an existing staff/admin member's PIN. Same admin-only re-check as the create route. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session || session.appUser.role !== "admin") {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json()) as { pin?: string };
  if (!body.pin) {
    return NextResponse.json({ error: "กรุณาระบุ PIN" }, { status: 400 });
  }

  const db = getAdminDb();
  const userSnap = await db.collection(COLLECTIONS.users).doc(id).get();
  if (!userSnap.exists) {
    return NextResponse.json({ error: "ไม่พบพนักงาน" }, { status: 404 });
  }

  try {
    await assignPin(db, session.appUser.shopId, id, body.pin);
  } catch (error) {
    if (error instanceof PinConflictError || error instanceof InvalidPinError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({ ok: true });
}
