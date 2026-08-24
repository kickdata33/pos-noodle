import { NextResponse, type NextRequest } from "next/server";

import { getServerSession } from "@/lib/auth/session";
import { InvalidPinError, PinConflictError, assignPin } from "@/lib/auth/pinAssignment";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { UserRole } from "@/types";

/**
 * Create a staff/admin account with a PIN (item 17). Creating a Firebase Auth user and writing
 * PIN material both require the Admin SDK, which is unreachable from a client component — hence
 * a server route instead of a plain `userRepository.create` call.
 *
 * Re-checks `role === "admin"` server-side even though `/admin` is already gated: the Admin SDK
 * bypasses Security Rules by design (same reasoning as `/api/auth/pin`), so this route is the
 * only thing standing between an unauthenticated request and creating an account.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session || session.appUser.role !== "admin") {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
  }

  const body = (await request.json()) as { name?: string; role?: UserRole; pin?: string };
  const name = body.name?.trim();
  const role = body.role;
  const pin = body.pin;

  if (!name || (role !== "admin" && role !== "staff") || !pin) {
    return NextResponse.json({ error: "ข้อมูลไม่ครบ" }, { status: 400 });
  }

  const db = getAdminDb();
  const shopId = session.appUser.shopId;

  const created = await getAdminAuth().createUser({ displayName: name });

  try {
    await assignPin(db, shopId, created.uid, pin);
  } catch (error) {
    // Roll back the orphaned Auth user rather than leaving an account with no way to log in.
    await getAdminAuth().deleteUser(created.uid);
    if (error instanceof PinConflictError || error instanceof InvalidPinError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  await db.collection(COLLECTIONS.users).doc(created.uid).set({
    shopId,
    name,
    email: null,
    role,
    active: true,
    createdAt: Date.now(),
  });

  return NextResponse.json({ id: created.uid });
}
