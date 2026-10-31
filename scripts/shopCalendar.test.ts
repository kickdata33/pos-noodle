/**
 * Tests for the pure "วันหยุดร้าน" resolution logic in `src/lib/pos/shopCalendar.ts`
 * (run: npm run test:pos).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  closedDateKeysInRange,
  dateKeysInMonth,
  isShopClosedDay,
  resolveClosedStatus,
  toOverrideMap,
  weekdayOfDateKey,
} from "../src/lib/pos/shopCalendar";

test("isShopClosedDay: a day-of-month in the recurring rule is closed", () => {
  assert.equal(isShopClosedDay("2026-09-16", [1, 16], new Map()), true);
});

test("isShopClosedDay: a day-of-month not in the recurring rule is open", () => {
  assert.equal(isShopClosedDay("2026-09-17", [1, 16], new Map()), false);
});

test("isShopClosedDay: an override forcing a normally-open day closed wins", () => {
  const overrides = new Map([["2026-09-13", true]]);
  assert.equal(isShopClosedDay("2026-09-13", [1, 16], overrides), true);
});

test("isShopClosedDay: an override forcing a normally-closed day open wins", () => {
  const overrides = new Map([["2026-09-16", false]]);
  assert.equal(isShopClosedDay("2026-09-16", [1, 16], overrides), false);
});

test("isShopClosedDay: an empty recurring rule closes nothing unless overridden", () => {
  assert.equal(isShopClosedDay("2026-09-01", [], new Map()), false);
  assert.equal(isShopClosedDay("2026-09-01", [], new Map([["2026-09-01", true]])), true);
});

test("closedDateKeysInRange: 14th open, 15th open, 16th forced open, 17th open — none closed", () => {
  const overrides = new Map([["2026-09-16", false]]);
  const result = closedDateKeysInRange("2026-09-14", "2026-09-17", [1, 16], overrides);
  assert.deepEqual([...result], []);
});

test("closedDateKeysInRange: the 13th forced closed and the 16th left as the recurring default both show up", () => {
  const overrides = new Map([["2026-09-13", true]]);
  const result = closedDateKeysInRange("2026-09-12", "2026-09-16", [1, 16], overrides);
  assert.deepEqual([...result].sort(), ["2026-09-13", "2026-09-16"]);
});

test("resolveClosedStatus: tells apart recurring, override-closed, override-open, and open", () => {
  const overrides = new Map([
    ["2026-09-13", true],
    ["2026-09-16", false],
  ]);
  assert.equal(resolveClosedStatus("2026-09-01", [1, 16], overrides), "recurring");
  assert.equal(resolveClosedStatus("2026-09-13", [1, 16], overrides), "override-closed");
  assert.equal(resolveClosedStatus("2026-09-16", [1, 16], overrides), "override-open");
  assert.equal(resolveClosedStatus("2026-09-17", [1, 16], overrides), "open");
});

test("isShopClosedDay: still agrees with resolveClosedStatus after the refactor (recurring and override-closed are closed; override-open and open are not)", () => {
  const overrides = new Map([
    ["2026-09-13", true],
    ["2026-09-16", false],
  ]);
  assert.equal(isShopClosedDay("2026-09-01", [1, 16], overrides), true); // recurring
  assert.equal(isShopClosedDay("2026-09-13", [1, 16], overrides), true); // override-closed
  assert.equal(isShopClosedDay("2026-09-16", [1, 16], overrides), false); // override-open
  assert.equal(isShopClosedDay("2026-09-17", [1, 16], overrides), false); // open
});

test("dateKeysInMonth: every day of a 31-day month, in order", () => {
  const keys = dateKeysInMonth("2026-10");
  assert.equal(keys.length, 31);
  assert.equal(keys[0], "2026-10-01");
  assert.equal(keys[30], "2026-10-31");
});

test("dateKeysInMonth: a 28-day February (2026 is not a leap year)", () => {
  const keys = dateKeysInMonth("2026-02");
  assert.equal(keys.length, 28);
  assert.equal(keys[27], "2026-02-28");
});

test("dateKeysInMonth: a leap-year February has 29 days", () => {
  const keys = dateKeysInMonth("2028-02");
  assert.equal(keys.length, 29);
  assert.equal(keys[28], "2028-02-29");
});

test("weekdayOfDateKey: 2026-10-01 is a Thursday", () => {
  assert.equal(weekdayOfDateKey("2026-10-01"), 4); // 0=Sun..6=Sat
});

test("weekdayOfDateKey: 2026-11-01 is a Sunday", () => {
  assert.equal(weekdayOfDateKey("2026-11-01"), 0);
});

test("toOverrideMap: builds a dateKey -> closed lookup from raw override docs", () => {
  const map = toOverrideMap([
    { id: "a", shopId: "shop1", dateKey: "2026-09-13", closed: true, note: "", createdBy: "u1", createdByName: "Admin", createdAt: 0 },
    { id: "b", shopId: "shop1", dateKey: "2026-09-16", closed: false, note: "", createdBy: "u1", createdByName: "Admin", createdAt: 0 },
  ]);
  assert.equal(map.get("2026-09-13"), true);
  assert.equal(map.get("2026-09-16"), false);
  assert.equal(map.has("2026-09-01"), false);
});
