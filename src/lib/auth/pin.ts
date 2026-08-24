import { createHmac } from "node:crypto";

export { PIN_LENGTH, isValidPinFormat } from "./pinConstants";

/**
 * Throttling for failed PIN attempts. A 6-digit PIN is only 10^6 combinations, and the app is
 * reachable from the public internet, so without this a brute-force would succeed in minutes.
 * With it, an attacker gets 5 tries per 15 minutes — ~2,000 hours to cover half the keyspace.
 */
export const MAX_FAILED_ATTEMPTS = 5;
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Deterministic, peppered hash of a PIN. Same PIN + same shop + same pepper always yields the
 * same value, which is what lets the login route find the user by a single indexed lookup.
 *
 * The pepper is read from the environment and never stored in Firestore, so possession of the
 * database alone does not allow reversing these values. Rotating `PIN_PEPPER` invalidates every
 * stored PIN, so treat it as permanent for a deployment (all PINs would need to be re-issued).
 */
export function computePinLookup(pin: string, shopId: string): string {
  const pepper = process.env.PIN_PEPPER;
  if (!pepper) {
    throw new Error(
      "Missing PIN_PEPPER env var. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" and put it in .env.local."
    );
  }
  return createHmac("sha256", pepper).update(`${shopId}:${pin}`).digest("hex");
}

export interface ThrottleState {
  count: number;
  windowStart: number;
  blockedUntil: number | null;
}

export interface ThrottleDecision {
  blocked: boolean;
  /** Seconds the caller must wait. Only meaningful when `blocked` is true. */
  retryAfterSeconds: number;
}

/** Pure check — separated from Firestore so it can be unit-tested without a database. */
export function evaluateThrottle(state: ThrottleState | null, now: number): ThrottleDecision {
  if (state?.blockedUntil && state.blockedUntil > now) {
    return {
      blocked: true,
      retryAfterSeconds: Math.ceil((state.blockedUntil - now) / 1000),
    };
  }
  return { blocked: false, retryAfterSeconds: 0 };
}

/**
 * Pure state transition for a failed attempt. Attempts older than the window start a fresh
 * count, so a staff member who mistypes once in the morning isn't a step closer to a lockout
 * in the evening.
 */
export function registerFailure(state: ThrottleState | null, now: number): ThrottleState {
  const withinWindow = state !== null && now - state.windowStart < ATTEMPT_WINDOW_MS;
  const count = withinWindow ? state.count + 1 : 1;
  const windowStart = withinWindow ? state.windowStart : now;

  return {
    count,
    windowStart,
    blockedUntil: count >= MAX_FAILED_ATTEMPTS ? now + LOCKOUT_MS : null,
  };
}
