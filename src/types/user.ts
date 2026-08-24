import type { EpochMillis, WithId } from "./common";

export type UserRole = "admin" | "staff";

/**
 * Mirrors a Firebase Auth user 1:1 — `id` here equals the Firebase Auth UID. Role/active are
 * read from this Firestore doc (never from a client-trusted claim) to decide `/admin` access
 * (item 17, item 29).
 *
 * Staff sign in with a 6-digit PIN, so there is no email/password on the account. `email` stays
 * as an optional contact field an Admin may fill in; it is never a credential.
 *
 * NOTE: nothing PIN-related lives on this document, because staff and admin can both read
 * `users` docs from the client. The PIN material lives in `userSecrets` (see below), which
 * Security Rules deny to every client.
 */
export interface AppUser extends WithId {
  shopId: string;
  name: string;
  email: string | null;
  role: UserRole;
  active: boolean;
  createdAt: EpochMillis;
}

/**
 * Server-only PIN material, one doc per user, doc id = the user's Firebase Auth UID.
 *
 * `pinLookup` is HMAC-SHA256 of `${shopId}:${pin}` keyed with the server's `PIN_PEPPER` secret.
 * The raw PIN is never stored. Because the HMAC is deterministic, a login attempt can find the
 * matching user with a single indexed query instead of testing every user's hash — which is what
 * makes "type the PIN, nothing else" viable. The tradeoff of a deterministic hash (no per-user
 * salt) is accepted deliberately: the pepper lives only in the server environment, so a leak of
 * the Firestore data alone does not make the PINs brute-forceable, and `firestore.rules` denies
 * every client read of this collection.
 *
 * PINs must be unique per shop — two users sharing a PIN would make the lookup ambiguous, so
 * the write path rejects duplicates.
 */
export interface UserSecret extends WithId {
  shopId: string;
  pinLookup: string;
  updatedAt: EpochMillis;
}

/**
 * Failed-PIN throttling state, one doc per client key (currently the caller's IP).
 * Kept server-side only. See `lib/auth/pin.ts` for the thresholds.
 */
export interface PinAttempt extends WithId {
  count: number;
  windowStart: EpochMillis;
  blockedUntil: EpochMillis | null;
}
