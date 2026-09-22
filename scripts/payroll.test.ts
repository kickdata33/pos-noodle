/**
 * Tests for the pure payroll math in `src/lib/pos/payroll.ts` (run: npm run test:pos).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  computeAccrual,
  computeAvailableAdvance,
  computeCurrentPeriodStart,
  computeSettlementPreview,
  suggestedSettlementEnd,
} from "../src/lib/pos/payroll";

test("computeCurrentPeriodStart: never-settled employee starts on their own createdDateKey", () => {
  assert.equal(computeCurrentPeriodStart("2026-09-01", null), "2026-09-01");
});

test("computeCurrentPeriodStart: next period starts the day after the last settlement's periodEnd", () => {
  assert.equal(computeCurrentPeriodStart("2026-09-01", "2026-09-14"), "2026-09-15");
});

test("computeAccrual: every day in range counts when nothing is marked absent", () => {
  const result = computeAccrual("2026-09-15", "2026-09-21", 300, new Set());
  assert.equal(result.daysWorked, 7);
  assert.equal(result.accruedWage, 2100);
});

test("computeAccrual: an absent day doesn't accrue wage", () => {
  const result = computeAccrual("2026-09-15", "2026-09-21", 300, new Set(["2026-09-17", "2026-09-20"]));
  assert.equal(result.daysWorked, 5);
  assert.equal(result.accruedWage, 1500);
});

test("computeAccrual: a single-day range still counts that one day", () => {
  const result = computeAccrual("2026-09-15", "2026-09-15", 300, new Set());
  assert.equal(result.daysWorked, 1);
  assert.equal(result.accruedWage, 300);
});

test("computeAccrual: an inverted/empty range (period hasn't started yet) accrues nothing", () => {
  const result = computeAccrual("2026-09-20", "2026-09-15", 300, new Set());
  assert.equal(result.daysWorked, 0);
  assert.equal(result.accruedWage, 0);
});

test("computeAvailableAdvance: full accrued amount is available when nothing's been taken yet", () => {
  assert.equal(computeAvailableAdvance(1500, 0), 1500);
});

test("computeAvailableAdvance: shrinks as advances are taken", () => {
  assert.equal(computeAvailableAdvance(1500, 900), 600);
});

test("computeAvailableAdvance: floors at zero, never goes negative", () => {
  assert.equal(computeAvailableAdvance(1500, 1500), 0);
  assert.equal(computeAvailableAdvance(1500, 2000), 0);
});

test("computeSettlementPreview: combines accrual and advances into a net payout", () => {
  const preview = computeSettlementPreview("2026-09-15", "2026-09-21", 300, new Set(["2026-09-17"]), 800);
  assert.equal(preview.daysWorked, 6);
  assert.equal(preview.accruedWage, 1800);
  assert.equal(preview.totalAdvances, 800);
  assert.equal(preview.netPaid, 1000);
});

test("computeSettlementPreview: netPaid can go negative if advances somehow exceed accrual (not floored)", () => {
  const preview = computeSettlementPreview("2026-09-15", "2026-09-21", 300, new Set(), 3000);
  assert.equal(preview.accruedWage, 2100);
  assert.equal(preview.netPaid, -900);
});

test("suggestedSettlementEnd: on the 16th, suggests the 15th of the same month", () => {
  assert.equal(suggestedSettlementEnd("2026-09-16"), "2026-09-15");
});

test("suggestedSettlementEnd: on the 1st, suggests the last day of the previous month", () => {
  assert.equal(suggestedSettlementEnd("2026-10-01"), "2026-09-30");
});

test("suggestedSettlementEnd: on the 1st of January, rolls back to Dec 31 of the previous year", () => {
  assert.equal(suggestedSettlementEnd("2026-01-01"), "2025-12-31");
});

test("suggestedSettlementEnd: any other day just suggests today (freely editable, not a hard cutoff)", () => {
  assert.equal(suggestedSettlementEnd("2026-09-10"), "2026-09-10");
});
