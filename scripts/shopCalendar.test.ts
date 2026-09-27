/**
 * Tests for the pure "วันหยุดร้าน" resolution logic in `src/lib/pos/shopCalendar.ts`
 * (run: npm run test:pos).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { closedDateKeysInRange, isShopClosedDay, toOverrideMap } from "../src/lib/pos/shopCalendar";

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

test("toOverrideMap: builds a dateKey -> closed lookup from raw override docs", () => {
  const map = toOverrideMap([
    { id: "a", shopId: "shop1", dateKey: "2026-09-13", closed: true, note: "", createdBy: "u1", createdByName: "Admin", createdAt: 0 },
    { id: "b", shopId: "shop1", dateKey: "2026-09-16", closed: false, note: "", createdBy: "u1", createdByName: "Admin", createdAt: 0 },
  ]);
  assert.equal(map.get("2026-09-13"), true);
  assert.equal(map.get("2026-09-16"), false);
  assert.equal(map.has("2026-09-01"), false);
});
