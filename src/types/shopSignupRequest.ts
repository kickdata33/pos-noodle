import type { EpochMillis, WithId } from "./common";

export type ShopSignupRequestStatus = "pending" | "approved" | "rejected";

/**
 * A prospective shop's application to join the platform (SaaS roadmap Phase 2). Submitted
 * unauthenticated via `/signup` (Admin SDK route, same trust model as the customer-order
 * routes — the public browser never touches Firestore directly, see `firestore.rules`'
 * `allow read, write: if false` on this collection). Reviewed and provisioned by the superadmin
 * console (`/superadmin`), never automatically approved — the user chose "fill a form, we
 * approve/create it" over full self-serve account creation for this phase.
 */
export interface ShopSignupRequest extends WithId {
  shopName: string;
  /** The slug the applicant asked for. May already be taken by the time it's reviewed — the
   * superadmin can assign a different one at approval time; this field is never mutated. */
  requestedSlug: string;
  ownerName: string;
  phone: string;
  email: string | null;
  /** Free-text note from the applicant (special requests, how many tables, etc.). */
  note: string | null;
  status: ShopSignupRequestStatus;
  createdAt: EpochMillis;
  reviewedAt: EpochMillis | null;
  /** Once approved: the real `shopId` that was created for this request. */
  approvedShopId: string | null;
  /**
   * Once approved: the slug/admin actually assigned (the superadmin can edit both at approval
   * time, so these can differ from `requestedSlug`/`ownerName` above) — kept so the console can
   * show the shop's link and admin name again on any later visit, not only in the one-time
   * approval dialog. Deliberately does NOT include the PIN itself: unlike these two, a PIN is a
   * login credential, so it's never persisted in plaintext anywhere outside the one-time dialog
   * (see `assignPin`'s HMAC-only storage) — use "รีเซ็ต PIN" on an approved card to issue a new
   * one if the original was missed/lost.
   */
  finalSlug: string | null;
  assignedAdminUid: string | null;
  assignedAdminName: string | null;
  /** Once rejected: why, shown nowhere to the applicant today (no notification flow yet) — kept
   * only so the superadmin console can show its own history of past decisions. */
  rejectionReason: string | null;
}
