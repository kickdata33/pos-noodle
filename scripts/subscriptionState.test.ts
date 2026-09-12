/**
 * Tests for the pure billing state-transition math (run: npm run test:billing).
 * See `src/lib/billing/subscriptionState.ts` — no Firestore/Omise I/O here.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  computeGraceEnd,
  computeTrialEnd,
  GRACE_PERIOD_DAYS,
  isGraceExpired,
  nextMonthlyBillingDate,
  shouldSuspendForNoCard,
} from "../src/lib/billing/subscriptionState";

const DAY_MS = 24 * 60 * 60 * 1000;

test("computeTrialEnd adds the configured number of days", () => {
  const now = Date.UTC(2026, 0, 1); // Jan 1, 2026
  assert.equal(computeTrialEnd(now, 14), now + 14 * DAY_MS);
  assert.equal(computeTrialEnd(now, 0), now, "zero-day trial is a same-instant edge case, not an error");
});

test("computeGraceEnd is exactly GRACE_PERIOD_DAYS after now", () => {
  const now = Date.UTC(2026, 0, 1);
  assert.equal(GRACE_PERIOD_DAYS, 3);
  assert.equal(computeGraceEnd(now), now + 3 * DAY_MS);
});

test("isGraceExpired boundary: false one ms before, true exactly at, true one ms after", () => {
  const graceEndsAt = Date.UTC(2026, 0, 4);
  assert.equal(isGraceExpired(graceEndsAt, graceEndsAt - 1), false);
  assert.equal(isGraceExpired(graceEndsAt, graceEndsAt), true);
  assert.equal(isGraceExpired(graceEndsAt, graceEndsAt + 1), true);
});

test("nextMonthlyBillingDate preserves day-of-month in an ordinary month", () => {
  const from = Date.UTC(2026, 2, 15); // Mar 15, 2026
  const next = nextMonthlyBillingDate(from);
  const d = new Date(next);
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 3, "April (0-indexed 3)");
  assert.equal(d.getUTCDate(), 15);
});

test("nextMonthlyBillingDate clamps Jan 31 -> Feb 28 (non-leap year)", () => {
  const from = Date.UTC(2026, 0, 31); // Jan 31, 2026 (2026 is not a leap year)
  const next = nextMonthlyBillingDate(from);
  const d = new Date(next);
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 1, "February (0-indexed 1)");
  assert.equal(d.getUTCDate(), 28);
});

test("nextMonthlyBillingDate clamps Jan 31 -> Feb 29 in a leap year", () => {
  const from = Date.UTC(2028, 0, 31); // Jan 31, 2028 (2028 is a leap year)
  const next = nextMonthlyBillingDate(from);
  const d = new Date(next);
  assert.equal(d.getUTCFullYear(), 2028);
  assert.equal(d.getUTCMonth(), 1, "February (0-indexed 1)");
  assert.equal(d.getUTCDate(), 29);
});

test("nextMonthlyBillingDate rolls over the year boundary", () => {
  const from = Date.UTC(2026, 11, 20); // Dec 20, 2026
  const next = nextMonthlyBillingDate(from);
  const d = new Date(next);
  assert.equal(d.getUTCFullYear(), 2027);
  assert.equal(d.getUTCMonth(), 0, "January (0-indexed 0)");
  assert.equal(d.getUTCDate(), 20);
});

test("shouldSuspendForNoCard: true only when trialing, no card ever added, and trial has ended", () => {
  const trialEndsAt = Date.UTC(2026, 0, 15);

  assert.equal(
    shouldSuspendForNoCard("trialing", trialEndsAt, null, trialEndsAt),
    true,
    "trial just ended, no card on file"
  );
  assert.equal(
    shouldSuspendForNoCard("trialing", trialEndsAt, null, trialEndsAt - 1),
    false,
    "trial hasn't ended yet"
  );
  assert.equal(
    shouldSuspendForNoCard("trialing", trialEndsAt, trialEndsAt, trialEndsAt + DAY_MS),
    false,
    "a card was added (nextBillingDate set) — handled by the charge-attempt path, not this"
  );
  assert.equal(
    shouldSuspendForNoCard("active", trialEndsAt, null, trialEndsAt + DAY_MS),
    false,
    "already active — not a trialing shop"
  );
  assert.equal(
    shouldSuspendForNoCard("suspended", trialEndsAt, null, trialEndsAt + DAY_MS),
    false,
    "already suspended — nothing to do"
  );
});
