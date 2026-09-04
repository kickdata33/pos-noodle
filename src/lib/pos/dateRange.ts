/**
 * Bangkok-local date math for the sales report (item: "รายงานสรุปยอด"). Thailand has a single
 * fixed UTC+7 offset with no DST, so a hardcoded offset is safe and avoids depending on the
 * host machine's timezone (server in Vercel's `sin1`, staff's phone, this sandbox — all UTC or
 * unknown) ever producing a different "today" than the shop actually sees. All `*Ms` values
 * below are ordinary epoch milliseconds — the same representation `Order.createdAt`/`paidAt`
 * already use (see `types/order.ts`), so callers never convert.
 */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" in Bangkok local time — the key used to group orders by calendar day. */
export function bangkokDateKey(epochMs: number): string {
  const shifted = new Date(epochMs + BANGKOK_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Hour of day (0–23) in Bangkok local time — drives the "peak hours" chart. */
export function bangkokHour(epochMs: number): number {
  return new Date(epochMs + BANGKOK_OFFSET_MS).getUTCHours();
}

/** 0 = Monday .. 6 = Sunday, in Bangkok local time (re-based from JS's Sunday-first 0–6). */
export function bangkokWeekday(epochMs: number): number {
  const jsDay = new Date(epochMs + BANGKOK_OFFSET_MS).getUTCDay(); // 0 = Sunday
  return (jsDay + 6) % 7;
}

/** The [start, end] epoch-ms bounds of one Bangkok calendar day, both inclusive. */
export function bangkokDayBounds(dateKey: string): { startMs: number; endMs: number } {
  const [y, m, d] = dateKey.split("-").map(Number);
  const startMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - BANGKOK_OFFSET_MS;
  return { startMs, endMs: startMs + DAY_MS - 1 };
}

export function addDaysToKey(dateKey: string, days: number): string {
  const { startMs } = bangkokDayBounds(dateKey);
  return bangkokDateKey(startMs + days * DAY_MS);
}

/** Every "YYYY-MM-DD" key from `startKey` to `endKey`, inclusive, in order. */
export function dateKeysBetween(startKey: string, endKey: string): string[] {
  const keys: string[] = [];
  let key = startKey;
  // A bounded guard against a caller passing endKey before startKey — never loops forever.
  for (let i = 0; i < 3660 && key <= endKey; i++) {
    keys.push(key);
    key = addDaysToKey(key, 1);
  }
  return keys;
}

export type ReportPreset = "today" | "last7" | "thisWeek" | "thisMonth";

export interface DateRange {
  startKey: string;
  endKey: string;
  startMs: number;
  endMs: number;
}

function rangeFromKeys(startKey: string, endKey: string): DateRange {
  return { startKey, endKey, startMs: bangkokDayBounds(startKey).startMs, endMs: bangkokDayBounds(endKey).endMs };
}

/** The date range for a named preset, anchored to `nowMs` (defaults to now — a param for tests). */
export function resolvePreset(preset: ReportPreset, nowMs: number = Date.now()): DateRange {
  const todayKey = bangkokDateKey(nowMs);

  switch (preset) {
    case "today":
      return rangeFromKeys(todayKey, todayKey);
    case "last7":
      return rangeFromKeys(addDaysToKey(todayKey, -6), todayKey);
    case "thisWeek": {
      const monday = addDaysToKey(todayKey, -bangkokWeekday(nowMs));
      return rangeFromKeys(monday, addDaysToKey(monday, 6));
    }
    case "thisMonth": {
      const [y, m] = todayKey.split("-");
      return rangeFromKeys(`${y}-${m}-01`, todayKey);
    }
  }
}

/** A caller-picked "YYYY-MM-DD" .. "YYYY-MM-DD" range, e.g. from two `<input type="date">`s. */
export function customRange(startKey: string, endKey: string): DateRange {
  // Swap silently rather than returning an empty/inverted range if the user picks "to" before
  // "from" — a report with zero rows for a range that plainly isn't empty reads as a bug.
  return startKey <= endKey ? rangeFromKeys(startKey, endKey) : rangeFromKeys(endKey, startKey);
}
