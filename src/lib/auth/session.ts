import "server-only";

import { cookies } from "next/headers";

import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { AppUser } from "@/types";

export const SESSION_COOKIE_NAME = "session";
/** 5 days, matches the max Firebase session cookie lifetime we request in the API route. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 5;

export interface ServerSession {
  uid: string;
  appUser: AppUser;
}

/**
 * Verifies the session cookie (server-side only — Admin SDK, bypasses Security Rules by
 * design) and resolves the caller's `AppUser` doc for role/active. Used by the `/admin` and
 * `/pos` layouts to gate access (item 17, item 29) before rendering anything — which means
 * this runs on nearly every navigation (almost every route is server-rendered), so its latency
 * is felt as general app sluggishness, not just on first load.
 *
 * `verifySessionCookie`'s 2nd arg (`checkRevoked`) is deliberately `false`: passing `true` adds
 * an extra network round-trip to Firebase's Auth backend *on every single request* to check
 * whether `revokeRefreshTokens()` was ever called for this user — a real, user-visible latency
 * cost. Nothing in this codebase ever calls `revokeRefreshTokens()` (PIN reset doesn't either),
 * so that check was paying full price for zero actual benefit. The `appUser.active` check right
 * below already re-reads the live `users` doc on every request, so deactivating a staff account
 * still takes effect immediately regardless — this only affects the (currently unused) case of
 * force-logging-out one specific still-active session.
 *
 * Returns null for: no cookie, an invalid/expired/malformed cookie, no matching `users` doc, or
 * an explicitly deactivated account — callers should treat all of these as "not logged in".
 */
export async function getServerSession(): Promise<ServerSession | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  try {
    const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, false);
    const userSnap = await getAdminDb().collection(COLLECTIONS.users).doc(decoded.uid).get();
    if (!userSnap.exists) return null;

    const appUser = { id: userSnap.id, ...userSnap.data() } as AppUser;
    if (!appUser.active) return null;

    return { uid: decoded.uid, appUser };
  } catch {
    // Expired or malformed cookie — treat the same as logged out.
    return null;
  }
}
