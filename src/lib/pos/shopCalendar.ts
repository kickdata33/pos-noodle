import { dateKeysBetween } from "./dateRange";
import type { ShopClosedDate } from "@/types";

/**
 * Resolves whether the shop is closed on a given calendar day (item: "กำหนดวันหยุดร้านได้") —
 * a recurring "closed on these days of every month" rule (`closedDaysOfMonth`, e.g. `[1, 16]`)
 * with per-date overrides on top for anything that doesn't fit the recurring pattern (an extra
 * holiday, or staying open on a day that would normally be closed). An override for the exact
 * `dateKey` always wins over the recurring rule, whichever direction it goes.
 *
 * Pure — no Firestore, no `Date.now()` — same split as the rest of `lib/pos`, unit-tested
 * directly (`scripts/shopCalendar.test.ts`).
 */
export function isShopClosedDay(
  dateKey: string,
  closedDaysOfMonth: readonly number[],
  overridesByDateKey: ReadonlyMap<string, boolean>
): boolean {
  const override = overridesByDateKey.get(dateKey);
  if (override !== undefined) return override;
  const day = Number(dateKey.split("-")[2]);
  return closedDaysOfMonth.includes(day);
}

/** Every closed `dateKey` between `startKey` and `endKey` inclusive — a small convenience for
 * callers (payroll accrual, the settings UI's preview) that need the resolved set rather than
 * checking one date at a time. */
export function closedDateKeysInRange(
  startKey: string,
  endKey: string,
  closedDaysOfMonth: readonly number[],
  overridesByDateKey: ReadonlyMap<string, boolean>
): Set<string> {
  return new Set(
    dateKeysBetween(startKey, endKey).filter((key) => isShopClosedDay(key, closedDaysOfMonth, overridesByDateKey))
  );
}

/** Builds the `dateKey -> closed` lookup `isShopClosedDay`/`closedDateKeysInRange` take, from the
 * raw override docs a repository subscription hands back — kept out of components so every
 * caller builds the map the same way. */
export function toOverrideMap(overrides: readonly ShopClosedDate[]): Map<string, boolean> {
  return new Map(overrides.map((o) => [o.dateKey, o.closed]));
}
