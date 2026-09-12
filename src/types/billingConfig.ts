import type { EpochMillis, WithId } from "./common";

/**
 * Singleton doc (id is always `"default"`) holding the platform's trial length and monthly
 * price — deliberately a Firestore doc, not an env var, so the superadmin can change pricing
 * at runtime from `/superadmin/billing-config` without a redeploy (SaaS roadmap Phase 3).
 *
 * Server-only, same trust model as every other `/api/superadmin/*`-only collection: Admin SDK
 * access exclusively, denied to every client in `firestore.rules`.
 */
export interface BillingConfig extends WithId {
  trialDays: number;
  monthlyPriceThb: number;
  /**
   * Bank-transfer/PromptPay payment details (SaaS roadmap Phase 3) — one shared account for
   * every shop on the platform (confirmed with the user), not per-shop. Shown at `/billing`
   * alongside the card option; a shop that transfers instead uploads a slip for manual review
   * (see `PaymentSlip`). Empty strings mean "not set up yet" — `/billing` hides the transfer
   * option entirely until `bankAccountNumber` is non-empty.
   */
  bankAccountName: string;
  bankName: string;
  bankAccountNumber: string;
  /** Optional PromptPay/bank QR code image (compressed JPEG data URL, see `compressImage.ts`)
   * the superadmin uploads once — shown next to the bank details so a shop can scan instead of
   * typing the account number. `null` if not uploaded. */
  qrCodeImage: string | null;
  updatedAt: EpochMillis;
}
