import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { BillingConfig } from "@/types";

export const BILLING_CONFIG_DOC_ID = "default";

/**
 * Emergency fallback used only if `billingConfig/default` doesn't exist yet (e.g. right after
 * this feature first deploys, before the superadmin has visited `/superadmin/billing-config`
 * once to set real values). Never used once that doc exists — see `getBillingConfig`.
 */
const FALLBACK_CONFIG: Omit<BillingConfig, "id"> = {
  trialDays: 14,
  monthlyPriceThb: 299,
  updatedAt: 0,
};

/** Reads the platform's current trial-days/monthly-price config (SaaS roadmap Phase 3). */
export async function getBillingConfig(db: Firestore): Promise<BillingConfig> {
  const snap = await db.collection(COLLECTIONS.billingConfig).doc(BILLING_CONFIG_DOC_ID).get();
  if (!snap.exists) {
    return { id: BILLING_CONFIG_DOC_ID, ...FALLBACK_CONFIG };
  }
  return { id: snap.id, ...(snap.data() as Omit<BillingConfig, "id">) };
}
