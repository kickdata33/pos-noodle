/**
 * Minimum spacing between two `/signup` submissions from the same IP — same pure-predicate
 * pattern as `lib/pos/customerThrottle.ts`'s per-table throttle, just a longer interval since
 * this guards a public lead-capture form against spam/scripted abuse rather than an accidental
 * double-tap on a real order.
 */
export const SIGNUP_MIN_INTERVAL_MS = 60_000;

export function isSignupThrottled(lastSubmittedAt: number | null, now: number): boolean {
  if (lastSubmittedAt === null) return false;
  return now - lastSubmittedAt < SIGNUP_MIN_INTERVAL_MS;
}
