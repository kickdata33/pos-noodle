import { NextResponse, type NextRequest } from "next/server";

import { getServerSession } from "@/lib/auth/session";
import { InvalidPinError, PinConflictError, assignPin } from "@/lib/auth/pinAssignment";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";

/**
 * Self-service PIN set — the other end of `AppUser.mustChangePin` (see that field's comment).
 * Reached right after logging in with a temporary PIN an Admin just set (new account or a
 * reset); this is what lets that person replace it with a PIN only they know, since not even
 * the system can tell them the temporary one again once it's hashed.
 *
 * No role check beyond "is signed in" — unlike `/api/admin/staff*`, this only ever touches the
 * caller's own account (`session.uid`), never anyone else's, so there's nothing here for an
 * Admin-only gate to protect.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบใหม่" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { pin?: string } | null;
  if (!body?.pin) {
    return NextResponse.json({ error: "กรุณาระบุ PIN" }, { status: 400 });
  }

  try {
    await assignPin(getAdminDb(), session.appUser.shopId, session.uid, body.pin);
  } catch (error) {
    if (error instanceof PinConflictError || error instanceof InvalidPinError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  await getAdminDb().collection(COLLECTIONS.users).doc(session.uid).update({ mustChangePin: false });

  // So the client can resolve a locked account's one-and-only page the same way `/api/auth/pin`
  // does — `session.appUser` here is the pre-login snapshot, but `allowedPosPages` isn't touched
  // by this route, so it's still accurate.
  return NextResponse.json({ ok: true, allowedPosPages: session.appUser.allowedPosPages ?? null });
}
