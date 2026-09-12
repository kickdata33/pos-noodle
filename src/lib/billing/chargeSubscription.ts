import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { Subscription } from "@/types";

import { chargeOmiseCustomer } from "./omiseClient";
import { computeGraceEnd, nextMonthlyBillingDate } from "./subscriptionState";

export interface ChargeAttemptResult {
  ok: boolean;
  newStatus: Subscription["status"];
  error?: string;
}

/**
 * Attempts one charge for a subscription that's due (trial-end first charge or a recurring
 * monthly charge) and writes the outcome to Firestore. Shared by the daily cron
 * (`src/app/api/cron/billing/route.ts` via `billingCron.ts`) and the superadmin's manual
 * "retry charge" override (`/api/superadmin/subscriptions/[shopId]/retry-charge`) so both paths
 * apply the exact same success/failure state transitions (SaaS roadmap Phase 3).
 */
export async function chargeSubscription(db: Firestore, subscription: Subscription): Promise<ChargeAttemptResult> {
  if (!subscription.omiseCustomerId) {
    // Shouldn't be reachable via the cron's own queries (a due subscription always has a
    // customer id by then), but defend against a manual retry on a shop with no card yet.
    return { ok: false, newStatus: subscription.status, error: "ยังไม่มีบัตรผูกกับร้านนี้" };
  }

  const now = Date.now();
  const result = await chargeOmiseCustomer(subscription.omiseCustomerId, subscription.priceThb * 100);
  const ref = db.collection(COLLECTIONS.subscriptions).doc(subscription.id);

  if (result.ok) {
    const nextBillingDate = nextMonthlyBillingDate(subscription.nextBillingDate ?? now);
    await ref.update({
      status: "active",
      nextBillingDate,
      lastChargeStatus: "succeeded",
      lastChargeAt: now,
      lastChargeError: null,
      graceEndsAt: null,
      updatedAt: now,
    });
    return { ok: true, newStatus: "active" };
  }

  const errorMessage = result.error?.message ?? "การตัดบัตรไม่สำเร็จ";
  await ref.update({
    status: "past_due",
    lastChargeStatus: "failed",
    lastChargeAt: now,
    lastChargeError: errorMessage,
    // Keep the existing graceEndsAt if this is a retry within an already-running grace window
    // (a manual retry shouldn't reset the clock); start a fresh one if this is the first
    // failure for this billing cycle.
    graceEndsAt: subscription.graceEndsAt ?? computeGraceEnd(now),
    updatedAt: now,
  });
  return { ok: false, newStatus: "past_due", error: errorMessage };
}
