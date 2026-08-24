import type { EpochMillis, WithId } from "./common";

export type UserRole = "admin" | "staff";

/**
 * Mirrors a Firebase Auth user 1:1 — `id` here equals the Firebase Auth UID. Role/active are
 * read from this Firestore doc (never from a client-trusted claim) to decide `/admin` access
 * (item 17, item 29).
 */
export interface AppUser extends WithId {
  shopId: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: EpochMillis;
}
