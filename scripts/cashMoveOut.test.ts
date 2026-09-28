/**
 * Tests for the pure "ตัดเงินสดออก" math in `src/lib/pos/cashMoveOut.ts` (run: npm run test:pos).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  availableMonths,
  cashMoveOutRows,
  latestCashSafeCount,
  rowsForMonth,
  shiftMonthKey,
  totalMovedOut,
} from "../src/lib/pos/cashMoveOut";
import type { CashSafeCount, DailyFloat } from "../src/types";

function float(businessDayKey: string, cashMovedOut: number | null): DailyFloat {
  return {
    id: businessDayKey,
    shopId: "shop1",
    businessDayKey,
    startingCash: null,
    cashMovedOut,
    cashTransferAdjustment: null,
    closingCashCounted: null,
    closingCashCountedAt: null,
    updatedBy: "u1",
    updatedByName: "Admin",
    updatedAt: 0,
  };
}

function count(dateKey: string, amount: number, createdAt = 0): CashSafeCount {
  return { id: `${dateKey}-${createdAt}`, shopId: "shop1", dateKey, amount, note: "", createdBy: "u1", createdByName: "Admin", createdAt };
}

test("cashMoveOutRows: skips days with no cashMovedOut entered (null, not zero)", () => {
  const rows = cashMoveOutRows([float("2026-09-01", 500), float("2026-09-02", null), float("2026-09-03", 300)]);
  assert.deepEqual(
    rows.map((r) => r.dateKey),
    ["2026-09-01", "2026-09-03"]
  );
});

test("cashMoveOutRows: sorts ascending and accumulates a running total", () => {
  const rows = cashMoveOutRows([float("2026-09-03", 300), float("2026-09-01", 500), float("2026-09-02", 200)]);
  assert.deepEqual(
    rows.map((r) => ({ dateKey: r.dateKey, movedOut: r.movedOut, cumulative: r.cumulative })),
    [
      { dateKey: "2026-09-01", movedOut: 500, cumulative: 500 },
      { dateKey: "2026-09-02", movedOut: 200, cumulative: 700 },
      { dateKey: "2026-09-03", movedOut: 300, cumulative: 1000 },
    ]
  );
});

test("cashMoveOutRows: a zero cashMovedOut still counts as entered (0 is a real answer, not missing)", () => {
  const rows = cashMoveOutRows([float("2026-09-01", 0)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cumulative, 0);
});

test("totalMovedOut: the last row's cumulative, or 0 when nothing's ever been entered", () => {
  assert.equal(totalMovedOut([]), 0);
  const rows = cashMoveOutRows([float("2026-09-01", 500), float("2026-09-02", 200)]);
  assert.equal(totalMovedOut(rows), 700);
});

test("rowsForMonth: filters to one calendar month without touching the all-time cumulative", () => {
  const rows = cashMoveOutRows([float("2026-08-30", 100), float("2026-09-01", 500), float("2026-09-15", 200)]);
  const september = rowsForMonth(rows, "2026-09");
  assert.deepEqual(
    september.map((r) => r.dateKey),
    ["2026-09-01", "2026-09-15"]
  );
  // Cumulative on the September rows still includes August's 100 — never resets per month.
  assert.equal(september[0].cumulative, 600);
  assert.equal(september[1].cumulative, 800);
});

test("availableMonths: distinct YYYY-MM prefixes, most recent first", () => {
  const rows = cashMoveOutRows([float("2026-07-01", 100), float("2026-09-01", 500), float("2026-09-15", 200), float("2026-08-01", 50)]);
  assert.deepEqual(availableMonths(rows), ["2026-09", "2026-08", "2026-07"]);
});

test("shiftMonthKey: moves forward and backward within a year", () => {
  assert.equal(shiftMonthKey("2026-09", 1), "2026-10");
  assert.equal(shiftMonthKey("2026-09", -1), "2026-08");
});

test("shiftMonthKey: rolls over a year boundary in both directions", () => {
  assert.equal(shiftMonthKey("2026-12", 1), "2027-01");
  assert.equal(shiftMonthKey("2026-01", -1), "2025-12");
});

test("latestCashSafeCount: null when nobody has ever recorded a count", () => {
  assert.equal(latestCashSafeCount([]), null);
});

test("latestCashSafeCount: picks the most recent by dateKey", () => {
  const latest = latestCashSafeCount([count("2026-09-01", 1000), count("2026-09-15", 1800), count("2026-09-10", 1500)]);
  assert.equal(latest?.dateKey, "2026-09-15");
  assert.equal(latest?.amount, 1800);
});

test("latestCashSafeCount: ties on the same dateKey break by createdAt (the later entry wins)", () => {
  const latest = latestCashSafeCount([count("2026-09-15", 1800, 100), count("2026-09-15", 1900, 200)]);
  assert.equal(latest?.amount, 1900);
});
