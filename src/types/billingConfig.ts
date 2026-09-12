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
  updatedAt: EpochMillis;
}
