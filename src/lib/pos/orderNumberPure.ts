/**
 * Pure order-number logic, split out from `orderNumber.ts` so it can be unit tested without
 * pulling in `lib/firebase/client.ts` — importing that eagerly calls `getAuth()`, which throws
 * outside a real Firebase config (same reason `lib/auth/pin.ts` was split from
 * `pinConstants.ts` in Milestone 1).
 */
export interface OrderCounterState {
  date: string; // "YYYYMMDD"
  seq: number;
}

/** "YYYYMMDD" in the caller's local time. */
export function todayKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** Same day → increment; a new day → reset to 1. */
export function nextCounterState(current: OrderCounterState | null, now: Date): OrderCounterState {
  const date = todayKey(now);
  if (current && current.date === date) {
    return { date, seq: current.seq + 1 };
  }
  return { date, seq: 1 };
}

export function formatOrderNumber(state: OrderCounterState): string {
  return `${state.date}-${String(state.seq).padStart(4, "0")}`;
}
