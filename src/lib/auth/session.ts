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
 * `/pos` layouts to gate access (item 17, item 29) before rendering anything.
 *
 * Returns null for: no cookie, an invalid/expired/revoked cookie, no matching `users` doc, or
 * an explicitly deactivated account — callers should treat all of these as "not logged in".
 */
export async function getServerSession(): Promise<ServerSession | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  try {
    const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true);
    const userSnap = await getAdminDb().collection(COLLECTIONS.users).doc(decoded.uid).get();
    if (!userSnap.exists) return null;

    const appUser = { id: userSnap.id, ...userSnap.data() } as AppUser;
    if (!appUser.active) return null;

    return { uid: decoded.uid, appUser };
  } catch {
    // Expired, revoked, or malformed cookie — treat the same as logged out.
    return null;
  }
}
