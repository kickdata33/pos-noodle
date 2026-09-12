import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { Subscription } from "@/types";

import { chargeSubscription } from "./chargeSubscription";
import { isGraceExpired } from "./subscriptionState";

export interface BillingCronResult {
  suspendedNoCard: number;
  chargesAttempted: number;
  chargesSucceeded: number;
  chargesFailed: number;
  suspendedGraceExpired: number;
}

/**
 * The daily billing sweep (SaaS roadmap Phase 3) — the first scheduled job in this codebase,
 * invoked via `src/app/api/cron/billing/route.ts` on Vercel Cron (see `vercel.json`). Three
 * independent passes, each a plain query (no composite `in` + range index needed — simpler and
 * matches this codebase's existing straightforward-query style):
 *
 * 1. `trialing` shops whose trial ended with no card ever added -> suspend immediately (no
 *    grace — grace is a failed-*charge* concept only, per the confirmed requirement).
 * 2. `active`/`past_due` shops whose `nextBillingDate` is due -> attempt a charge via the
 *    shared `chargeSubscription()` (also used by the superadmin's manual retry button).
 * 3. `past_due` shops whose grace window has expired -> suspend (this is what the `/admin`
 *    and `/pos` layouts' access gate blocks on).
 */
export async function runBillingCron(db: Firestore, nowMs: number = Date.now()): Promise<BillingCronResult> {
  const result: BillingCronResult = {
    suspendedNoCard: 0,
    chargesAttempted: 0,
    chargesSucceeded: 0,
    chargesFailed: 0,
    suspendedGraceExpired: 0,
  };

  const subscriptions = db.collection(COLLECTIONS.subscriptions);

  // 1. Trial ended, no card ever added -> immediate suspend.
  const noCardSnap = await subscriptions
    .where("status", "==", "trialing")
    .where("nextBillingDate", "==", null)
    .where("trialEndsAt", "<=", nowMs)
    .get();
  for (const doc of noCardSnap.docs) {
    await doc.ref.update({ status: "suspended", updatedAt: nowMs });
    result.suspendedNoCard++;
  }

  // 2. Due charges — active or already-past_due shops (a past_due shop keeps its same
  //    nextBillingDate until a charge actually succeeds, so it keeps getting picked up here
  //    every day it's retried).
  for (const status of ["active", "past_due"] as const) {
    const dueSnap = await subscriptions
      .where("status", "==", status)
      .where("nextBillingDate", "<=", nowMs)
      .get();
    for (const doc of dueSnap.docs) {
      const subscription = { id: doc.id, ...(doc.data() as Omit<Subscription, "id">) };
      result.chargesAttempted++;
      const outcome = await chargeSubscription(db, subscription);
      if (outcome.ok) result.chargesSucceeded++;
      else result.chargesFailed++;
    }
  }

  // 3. Grace period expired while still unpaid -> suspend.
  const graceSnap = await subscriptions.where("status", "==", "past_due").get();
  for (const doc of graceSnap.docs) {
    const subscription = doc.data() as Omit<Subscription, "id">;
    if (subscription.graceEndsAt !== null && isGraceExpired(subscription.graceEndsAt, nowMs)) {
      await doc.ref.update({ status: "suspended", updatedAt: nowMs });
      result.suspendedGraceExpired++;
    }
  }

  return result;
}
