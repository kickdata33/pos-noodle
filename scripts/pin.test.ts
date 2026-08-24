/**
 * Tests for the PIN auth logic (run: npm run test:pin).
 *
 * These cover the pure pieces — hashing and the lockout state machine — which is where a
 * mistake would be both easy to make and security-relevant. Uses node:test so there's no test
 * framework dependency to install.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ATTEMPT_WINDOW_MS,
  computePinLookup,
  evaluateThrottle,
  isValidPinFormat,
  LOCKOUT_MS,
  MAX_FAILED_ATTEMPTS,
  registerFailure,
} from "../src/lib/auth/pin";

// computePinLookup reads PIN_PEPPER when called, not at import time, so setting it here is enough.
process.env.PIN_PEPPER = "test-pepper-do-not-use-in-production";

test("accepts exactly 6 digits, rejects everything else", () => {
  assert.equal(isValidPinFormat("123456"), true);
  assert.equal(isValidPinFormat("000000"), true);

  assert.equal(isValidPinFormat("12345"), false, "too short");
  assert.equal(isValidPinFormat("1234567"), false, "too long");
  assert.equal(isValidPinFormat("12345a"), false, "non-digit");
  assert.equal(isValidPinFormat(""), false, "empty");
  assert.equal(isValidPinFormat(" 123456"), false, "leading space");
  assert.equal(isValidPinFormat("123456\n"), false, "trailing newline must not slip past");
});

test("hash is deterministic, so PIN-only lookup can find the user", () => {
  assert.equal(computePinLookup("123456", "shop-a"), computePinLookup("123456", "shop-a"));
});

test("hash never contains the raw PIN", () => {
  const hash = computePinLookup("123456", "shop-a");
  assert.ok(!hash.includes("123456"));
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test("different PINs and different shops produce different hashes", () => {
  assert.notEqual(computePinLookup("123456", "shop-a"), computePinLookup("123457", "shop-a"));
  assert.notEqual(
    computePinLookup("123456", "shop-a"),
    computePinLookup("123456", "shop-b"),
    "same PIN at another shop must not collide"
  );
});

test("hash depends on the pepper", () => {
  const before = computePinLookup("123456", "shop-a");
  process.env.PIN_PEPPER = "a-different-pepper";
  const after = computePinLookup("123456", "shop-a");
  process.env.PIN_PEPPER = "test-pepper-do-not-use-in-production";

  assert.notEqual(before, after, "a leaked database without the pepper must not be enough");
});

test("throws rather than hashing with no pepper configured", () => {
  const saved = process.env.PIN_PEPPER;
  delete process.env.PIN_PEPPER;
  assert.throws(() => computePinLookup("123456", "shop-a"), /PIN_PEPPER/);
  process.env.PIN_PEPPER = saved;
});

test("locks out only on the configured attempt", () => {
  const now = 1_000_000;
  let state = null as ReturnType<typeof registerFailure> | null;

  for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
    state = registerFailure(state, now);
    assert.equal(state.blockedUntil, null, `attempt ${attempt} should not lock yet`);
    assert.equal(evaluateThrottle(state, now).blocked, false);
  }

  state = registerFailure(state, now);
  assert.equal(state.count, MAX_FAILED_ATTEMPTS);
  assert.equal(state.blockedUntil, now + LOCKOUT_MS);
  assert.equal(evaluateThrottle(state, now).blocked, true);
});

test("lockout expires", () => {
  const now = 1_000_000;
  let state = null as ReturnType<typeof registerFailure> | null;
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) state = registerFailure(state, now);

  assert.equal(evaluateThrottle(state, now + LOCKOUT_MS - 1).blocked, true);
  assert.equal(evaluateThrottle(state, now + LOCKOUT_MS + 1).blocked, false);
});

test("old failures fall out of the window instead of accumulating all day", () => {
  const morning = 1_000_000;
  const first = registerFailure(null, morning);
  assert.equal(first.count, 1);

  const evening = morning + ATTEMPT_WINDOW_MS + 1;
  const later = registerFailure(first, evening);
  assert.equal(later.count, 1, "counter should reset once the window has passed");
  assert.equal(later.windowStart, evening);
});

test("failures inside the window keep accumulating", () => {
  const start = 1_000_000;
  const first = registerFailure(null, start);
  const second = registerFailure(first, start + ATTEMPT_WINDOW_MS - 1);

  assert.equal(second.count, 2);
  assert.equal(second.windowStart, start, "window should not slide forward on each attempt");
});

test("no throttle state means not blocked", () => {
  assert.equal(evaluateThrottle(null, Date.now()).blocked, false);
});

test("reports a sane retry-after", () => {
  const now = 1_000_000;
  const state = { count: MAX_FAILED_ATTEMPTS, windowStart: now, blockedUntil: now + 60_000 };
  const decision = evaluateThrottle(state, now);

  assert.equal(decision.blocked, true);
  assert.equal(decision.retryAfterSeconds, 60);
});
