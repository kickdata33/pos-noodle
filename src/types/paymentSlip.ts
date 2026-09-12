import type { EpochMillis, WithId } from "./common";

/**
 * `pending` — shop submitted a slip, superadmin hasn't reviewed it yet.
 * `approved` — superadmin confirmed the transfer; the subscription was marked paid at the same
 *   time (see the approve route).
 * `rejected` — superadmin could not verify the transfer (wrong amount, unreadable image, etc.);
 *   the shop's subscription is untouched and stays whatever it was (still `past_due`/`suspended`
 *   until they submit a new slip or pay another way).
 */
export type PaymentSlipStatus = "pending" | "approved" | "rejected";

/**
 * A shop's manual bank-transfer/PromptPay payment submission (SaaS roadmap Phase 3 — bank
 * transfer alternative to Omise card billing). The shop uploads a photo of their transfer slip
 * at `/billing`; a human (the superadmin) looks at it and approves or rejects it — there is no
 * OCR/auto-verification in this version, by design (confirmed with the user).
 *
 * `slipImage` is a compressed JPEG data URL stored directly on the document (this codebase has
 * no file-storage/Cloud Storage setup — see `lib/billing/compressImage.ts` for why a client-side
 * resize keeps this comfortably under Firestore's 1 MiB document limit).
 *
 * Server-only: Admin SDK access exclusively (see `firestore.rules`) — a shop's own admin never
 * reads/writes this collection directly, only through `/api/billing/slip` (submit) and the
 * `/billing` page (Admin-SDK read of just that shop's own docs, filtered server-side by
 * `session.appUser.shopId` so a shop can't read another shop's slips).
 */
export interface PaymentSlip extends WithId {
  shopId: string;
  /** What the shop says they transferred — compared by eye against the slip image, not trusted
   * as fact until a superadmin approves. */
  amountThb: number;
  /** Compressed JPEG data URL (see `compressImage.ts`) — the photographed transfer slip. */
  slipImage: string;
  /** Optional free-text note from the shop (e.g. "โอนจากบัญชีชื่อภรรยา"). */
  note: string | null;
  status: PaymentSlipStatus;
  submittedAt: EpochMillis;
  reviewedAt: EpochMillis | null;
  /** Superadmin's reason, shown back to the shop, when rejecting. */
  reviewNote: string | null;
}
