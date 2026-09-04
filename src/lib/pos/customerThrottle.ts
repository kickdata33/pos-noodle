/**
 * Minimum spacing between two order submissions from the same table's QR link — cheap abuse
 * resistance against someone repeatedly re-submitting (by accident with a flaky connection, or
 * on purpose) rather than a real per-customer identity system, which a scan-to-order flow has no
 * way to establish anyway. Kept as a pure predicate so the interval math is unit-testable
 * without a Firestore round trip; the API route owns reading/writing the throttle doc itself.
 */
export const CUSTOMER_ORDER_MIN_INTERVAL_MS = 5000;

export function isThrottled(lastSubmittedAt: number | null, now: number): boolean {
  if (lastSubmittedAt === null) return false;
  return now - lastSubmittedAt < CUSTOMER_ORDER_MIN_INTERVAL_MS;
}
