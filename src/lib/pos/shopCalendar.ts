import { addDaysToKey, dateKeysBetween } from "./dateRange";
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

/** The four ways a given `dateKey` can resolve, told apart so the settings page's calendar can
 * style each one differently (item: "เปลี่ยนเป็นปฏิทินเลือกวันที่จริง" — the "วันหยุดร้าน" redesign
 * that replaced the old day-of-month 1-31 button grid). The recurring `closedDaysOfMonth` rule
 * itself was deliberately left untouched by that redesign — it keeps applying automatically to
 * every month going forward exactly as before; the calendar is just a friendlier surface for
 * reading it and layering per-date exceptions on top, not a replacement for it. */
export type ShopClosedStatus = "recurring" | "override-closed" | "override-open" | "open";

export function resolveClosedStatus(
  dateKey: string,
  closedDaysOfMonth: readonly number[],
  overridesByDateKey: ReadonlyMap<string, boolean>
): ShopClosedStatus {
  const override = overridesByDateKey.get(dateKey);
  if (override !== undefined) return override ? "override-closed" : "override-open";
  const day = Number(dateKey.split("-")[2]);
  return closedDaysOfMonth.includes(day) ? "recurring" : "open";
}

export function isShopClosedDay(
  dateKey: string,
  closedDaysOfMonth: readonly number[],
  overridesByDateKey: ReadonlyMap<string, boolean>
): boolean {
  const status = resolveClosedStatus(dateKey, closedDaysOfMonth, overridesByDateKey);
  return status === "recurring" || status === "override-closed";
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

/** Every "YYYY-MM-DD" date key in `monthKey` ("YYYY-MM"), in order — the full calendar month,
 * not clipped to today, since the owner may well be looking ahead (or back) when managing closed
 * days. Powers the "วันหยุดร้าน" card's calendar grid. */
export function dateKeysInMonth(monthKey: string): string[] {
  const [year, month] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startKey = `${monthKey}-01`;
  return dateKeysBetween(startKey, addDaysToKey(startKey, daysInMonth - 1));
}

/** 0 (Sunday) .. 6 (Saturday) for a plain "YYYY-MM-DD" key — reads the key's own y/m/d directly
 * as a calendar date with no timezone conversion involved (same trick the payroll page's
 * `formatKey` already uses for display). Used to pad a calendar grid's leading blank cells so the
 * 1st lands under the correct weekday column. */
export function weekdayOfDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
