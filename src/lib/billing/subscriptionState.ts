/**
 * Pure billing state-transition math (SaaS roadmap Phase 3) — no Firestore/Omise I/O here, so
 * this is directly unit-testable (see `scripts/subscriptionState.test.ts`), mirroring
 * `lib/pos/dateRange.ts`'s split between pure date math and the repositories/routes that
 * actually read/write. All `*Ms` values are ordinary epoch milliseconds.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const GRACE_PERIOD_DAYS = 3;

/** When a shop's free trial ends, from the moment it's provisioned. */
export function computeTrialEnd(nowMs: number, trialDays: number): number {
  return nowMs + trialDays * DAY_MS;
}

/** When the 3-day grace window ends, from the moment a charge first fails. */
export function computeGraceEnd(nowMs: number): number {
  return nowMs + GRACE_PERIOD_DAYS * DAY_MS;
}

/** True once `graceEndsAt` has passed — the cron's signal to suspend a `past_due` shop. */
export function isGraceExpired(graceEndsAt: number, nowMs: number): boolean {
  return nowMs >= graceEndsAt;
}

/**
 * The next monthly billing date after `fromMs`, preserving the day-of-month where possible.
 * Where the target month is shorter (e.g. Jan 31 -> Feb has no 31st), clamps to that month's
 * last day rather than overflowing into the following month — so Jan 31 -> Feb 28/29, not
 * Mar 2/3. Operates in UTC; billing dates only need day-level precision, not a shop's local
 * timezone, since a charge attempt within the same UTC day as `nextBillingDate` is due either
 * way.
 */
export function nextMonthlyBillingDate(fromMs: number): number {
  const d = new Date(fromMs);
  const day = d.getUTCDate();
  const targetMonthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  const daysInTargetMonth = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0)
  ).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  return (
    targetMonthStart +
    (clampedDay - 1) * DAY_MS +
    (fromMs - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), day))
  );
}

/**
 * True when a `trialing` shop's trial has ended with no card ever added (`nextBillingDate`
 * stays null until a card is added — see `types/subscription.ts`). This is an immediate-suspend
 * case, deliberately with NO grace period: grace is a failed-*charge* concept per the user's
 * explicit requirement, not a never-added-a-card concept.
 */
export function shouldSuspendForNoCard(
  status: "trialing" | "active" | "past_due" | "suspended" | "canceled",
  trialEndsAt: number,
  nextBillingDate: number | null,
  nowMs: number
): boolean {
  return status === "trialing" && nextBillingDate === null && nowMs >= trialEndsAt;
}
