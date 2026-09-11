import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

/**
 * The superadmin console's own lightweight, Firestore-independent auth (SaaS roadmap Phase 2).
 * Deliberately not a new `AppUser` role or Firestore-rules concept — there is exactly one
 * operator today, and this console's Admin-SDK routes already bypass Security Rules by design
 * (same trust model as `/api/admin/staff` and every `/api/customer/*` route), so the only thing
 * that needs guarding is "did this request present the shared secret". A stateless HMAC-signed
 * cookie (same `createHmac` pattern already used for PIN hashing in `lib/auth/pin.ts`) avoids
 * needing a session store for that.
 */
export const SUPERADMIN_COOKIE_NAME = "superadmin_session";
export const SUPERADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getAccessKey(): string {
  const key = process.env.SUPERADMIN_ACCESS_KEY;
  if (!key) {
    throw new Error(
      "Missing SUPERADMIN_ACCESS_KEY env var. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" and put it in .env.local."
    );
  }
  return key;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on mismatched lengths — a length mismatch is itself a safe, fast
  // "no match" (nothing timing-sensitive about the wrong length being visible).
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Whether a submitted access key matches `SUPERADMIN_ACCESS_KEY`, in constant time. */
export function verifyAccessKey(candidate: string): boolean {
  return constantTimeEquals(candidate, getAccessKey());
}

function sign(expiresAt: number): string {
  return createHmac("sha256", getAccessKey()).update(String(expiresAt)).digest("hex");
}

/** Issues a session token: `${expiresAtMs}.${hmac}` — stateless, nothing stored server-side. */
export function issueSessionToken(now: number = Date.now()): string {
  const expiresAt = now + SUPERADMIN_SESSION_MAX_AGE_SECONDS * 1000;
  return `${expiresAt}.${sign(expiresAt)}`;
}

export function verifySessionToken(token: string | undefined | null, now: number = Date.now()): boolean {
  if (!token) return false;
  const separatorIndex = token.indexOf(".");
  if (separatorIndex < 0) return false;

  const expiresAtStr = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || !signature) return false;
  if (expiresAt < now) return false;

  return constantTimeEquals(signature, sign(expiresAt));
}

/** Convenience for Server Components/Route Handlers: reads and verifies the cookie in one call. */
export async function hasSuperadminSession(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(SUPERADMIN_COOKIE_NAME)?.value);
}
