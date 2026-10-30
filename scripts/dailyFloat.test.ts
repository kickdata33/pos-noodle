/**
 * Tests for the daily cash-float math in `src/lib/pos/dailyFloat.ts` (run: npm run test:pos).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { checkCashFloat, combinedDifference } from "../src/lib/pos/dailyFloat";

// --- checkCashFloat --------------------------------------------------------------------------

test("checkCashFloat: both null when startingCash was never entered", () => {
  const result = checkCashFloat(null, 1770, 146, 1800, 0);
  assert.equal(result.expectedCashBeforeMoveOut, null);
  assert.equal(result.cashDifference, null);
});

test("checkCashFloat: expectedCashBeforeMoveOut set but cashDifference still null when closingCashCounted hasn't been counted yet", () => {
  const result = checkCashFloat(1720, 1770, 146, null, 0);
  assert.equal(result.expectedCashBeforeMoveOut, 1720 + 1770 - 146);
  assert.equal(result.countedBeforeMoveOut, null);
  assert.equal(result.cashDifference, null);
});

test("checkCashFloat: the exact day-29 scenario from the shop — a real เงินขาด (no cash was moved out that day)", () => {
  const result = checkCashFloat(1720, 1770, 146, 1800, 0);
  assert.equal(result.expectedCashBeforeMoveOut, 3344);
  assert.equal(result.countedBeforeMoveOut, 1800);
  assert.equal(result.cashDifference, 1800 - 3344);
});

test("checkCashFloat: the exact day-28 scenario — cash WAS moved out, counted AFTER (the field's real semantics)", () => {
  // The shop's actual workflow: starting 2,420, sold 1,815 cash, spent 570 cash, moved 2,500 to
  // the safe, then counted what was left in the drawer — 1,720. Typing that plain post-move-out
  // count directly (no mental "add 2,500 back" step) is exactly the fix for the production bug
  // where typing 1,720 into the old pre-move-out field silently doubled the shortfall.
  const result = checkCashFloat(2420, 1815, 570, 1720, 2500);
  // ควรมี (ก่อนโยกออก) = 2420 + 1815 - 570 = 3665
  assert.equal(result.expectedCashBeforeMoveOut, 3665);
  // นับได้จริง (ก่อนโยกออก, เทียบเท่า) = 1720 (นับได้จริง) + 2500 (โยกออก) = 4220
  assert.equal(result.countedBeforeMoveOut, 4220);
  // ผลต่าง = 4220 - 3665 = 555 เกิน — matches what the shop actually had, not a ฿1,945 phantom shortage
  assert.equal(result.cashDifference, 555);
});

test("checkCashFloat: correcting a mistyped cashMovedOut afterwards updates cashDifference live, not stale", () => {
  // Same day as above, but cashMovedOut gets corrected from 2,500 to 2,000 after closingCashCounted
  // was already saved — closingCashCounted (the plain physical count) never needs re-entering.
  const result = checkCashFloat(2420, 1815, 570, 1720, 2000);
  assert.equal(result.expectedCashBeforeMoveOut, 3665);
  assert.equal(result.countedBeforeMoveOut, 3720); // 1720 + 2000
  assert.equal(result.cashDifference, 55); // 3720 - 3665
});

test("checkCashFloat: a positive difference reads as เงินเกิน (no cash moved out)", () => {
  const result = checkCashFloat(2420, 1815, 570, 4220, 0);
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
