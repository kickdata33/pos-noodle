/**
 * Tests for the daily cash-float math in `src/lib/pos/dailyFloat.ts` (run: npm run test:pos).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { checkCashFloat, combinedDifference } from "../src/lib/pos/dailyFloat";

// --- checkCashFloat --------------------------------------------------------------------------

test("checkCashFloat: both null when startingCash was never entered", () => {
  const result = checkCashFloat(null, 1770, 146, 1800);
  assert.equal(result.expectedCashBeforeMoveOut, null);
  assert.equal(result.cashDifference, null);
});

test("checkCashFloat: expectedCashBeforeMoveOut set but cashDifference still null when closingCash hasn't been counted yet", () => {
  const result = checkCashFloat(1720, 1770, 146, null);
  assert.equal(result.expectedCashBeforeMoveOut, 1720 + 1770 - 146);
  assert.equal(result.cashDifference, null);
});

test("checkCashFloat: the exact day-29 scenario from the shop — a real เงินขาด", () => {
  const result = checkCashFloat(1720, 1770, 146, 1800);
  assert.equal(result.expectedCashBeforeMoveOut, 3344);
  assert.equal(result.cashDifference, 1800 - 3344);
});

test("checkCashFloat: a positive difference reads as เงินเกิน", () => {
  const result = checkCashFloat(2420, 1815, 570, 4220);
  // ควรมี = 2420 + 1815 - 570 = 3665; นับได้ 4220 -> เกิน 555
  assert.equal(result.expectedCashBeforeMoveOut, 3665);
  assert.equal(result.cashDifference, 555);
});

// --- combinedDifference ----------------------------------------------------------------------

test("combinedDifference: null when the cash side was never counted — never silently assumed 0", () => {
  assert.equal(combinedDifference(null, 50, 0), null);
  assert.equal(combinedDifference(null, 0, 0), null);
});

test("combinedDifference: nets a cash shortage against a transfer overage of the same size — reads as truly balanced", () => {
  // A bill rung in as cash but actually paid by transfer: cash reads short by 200, the bank
  // transfer reads over by 200 (the money landed there instead) — combined, nothing's missing.
  assert.equal(combinedDifference(-200, 200, 0), 0);
});

test("combinedDifference: a cash shortage with no offsetting transfer overage stays a real shortage", () => {
  assert.equal(combinedDifference(-1544, 0, 0), -1544);
});

test("combinedDifference: adds a pending-transfer shortfall on top of an already-short cash count", () => {
  assert.equal(combinedDifference(-500, 0, 300), -800);
});

test("combinedDifference: a cash overage plus a transfer overage both add up positively", () => {
  assert.equal(combinedDifference(555, 50, 0), 605);
});
