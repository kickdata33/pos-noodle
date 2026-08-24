import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import {
  computePinLookup,
  evaluateThrottle,
  isValidPinFormat,
  registerFailure,
  type ThrottleState,
} from "@/lib/auth/pin";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import type { AppUser } from "@/types";

/**
 * PIN login (item 26: staff shouldn't have to type much). Verifies a 6-digit PIN entirely
 * server-side and returns a short-lived Firebase custom token. The client exchanges it via
 * `signInWithCustomToken`, then posts the resulting ID token to `/api/auth/session` for the
 * httpOnly session cookie — so from that point on, auth works exactly as it did with
 * email/password, and Firestore Security Rules still see a real `request.auth.uid`.
 *
 * Deliberately vague failure messages: a response that distinguished "no such PIN" from
 * "that account is disabled" would let an attacker enumerate valid PINs.
 */

/** Firestore doc ids can't contain "/" etc., and we shouldn't store raw IPs — hash the key. */
function throttleKeyFor(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export async function POST(request: NextRequest) {
  const { pin } = (await request.json()) as { pin?: string };

  if (!pin || !isValidPinFormat(pin)) {
    return NextResponse.json({ error: "รหัส PIN ไม่ถูกต้อง" }, { status: 400 });
  }

  const db = getAdminDb();
  const now = Date.now();
  const throttleRef = db.collection(COLLECTIONS.pinAttempts).doc(throttleKeyFor(request));

  const throttleSnap = await throttleRef.get();
  const throttleState = throttleSnap.exists ? (throttleSnap.data() as ThrottleState) : null;

  const decision = evaluateThrottle(throttleState, now);
  if (decision.blocked) {
    const minutes = Math.ceil(decision.retryAfterSeconds / 60);
    return NextResponse.json(
      { error: `ใส่รหัสผิดหลายครั้งเกินไป กรุณารออีก ${minutes} นาที` },
      { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } }
    );
  }

  const lookup = computePinLookup(pin, DEFAULT_SHOP_ID);
  const secretSnap = await db
    .collection(COLLECTIONS.userSecrets)
    .where("shopId", "==", DEFAULT_SHOP_ID)
    .where("pinLookup", "==", lookup)
    .limit(1)
    .get();

  const uid = secretSnap.empty ? null : secretSnap.docs[0].id;
  let appUser: AppUser | null = null;

  if (uid) {
    const userSnap = await db.collection(COLLECTIONS.users).doc(uid).get();
    if (userSnap.exists) {
      const candidate = { id: userSnap.id, ...userSnap.data() } as AppUser;
      if (candidate.active) appUser = candidate;
    }
  }

  if (!appUser) {
    await throttleRef.set(registerFailure(throttleState, now));
    return NextResponse.json({ error: "รหัส PIN ไม่ถูกต้อง" }, { status: 401 });
  }

  // Success — clear the throttle so a staff member who fumbled a digit isn't left near a lockout.
  if (throttleSnap.exists) await throttleRef.delete();

  const customToken = await getAdminAuth().createCustomToken(appUser.id);

  return NextResponse.json({
    customToken,
    role: appUser.role,
    name: appUser.name,
  });
}
