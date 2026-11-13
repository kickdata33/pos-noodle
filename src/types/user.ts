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
  /**
   * Which secondary `/pos/*` pages this account may open — the actual key list and labels live
   * in `lib/pos/posPages.ts` (kept out of `types/` the same way `ShopModuleKey` stays out of
   * `ShopSettings` below). `undefined`/`null` means unrestricted — every existing account before
   * this field existed, and every account an Admin hasn't deliberately narrowed, keeps seeing
   * every page exactly like before this existed.
   *
   * Exactly one entry is a special case, not just "restricted to one of six" — see
   * `resolveLockedPosPage` in `lib/pos/posPages.ts`: that one account is *locked* to that one
   * page, including being barred from the table-grid home and order screen that every other
   * staff account can always reach. This is what makes a dedicated single-purpose device (a
   * kitchen tablet, say) land straight on its one screen on login with no way back but signing
   * out. Two or more entries behaves like before — the table grid, filtered to just those links.
   */
  allowedPosPages?: string[] | null;
  /**
   * True right after an Admin creates this account or resets its PIN — the PIN that action just
   * set is a temporary one the Admin picked and can see on screen, not the account's real
   * working PIN (PINs are stored as a one-way hash — see `UserSecret` below — so once set, not
   * even the system itself can show it again). The next successful login with it is redirected
   * to `/set-pin` to choose a PIN only that person knows, which clears this flag. Absent/false
   * for every account that has completed that step, including every account that predates this
   * field (no migration needed — the same `undefined`-is-the-safe-default pattern as
   * `allowedPosPages` above).
   */
  mustChangePin?: boolean;
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
