/**
 * Tests for the order-numbering pure logic (run: npm run test:pos).
 *
 * Only the rollover/formatting logic is covered here — the Firestore transaction itself
 * (`generateOrderNumber`) is thin glue around this and needs a real database to exercise
 * meaningfully, so it's left to the manual Codespaces smoke test.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { formatOrderNumber, nextCounterState, todayKey } from "../src/lib/pos/orderNumberPure";

test("todayKey formats as YYYYMMDD with zero-padding", () => {
  assert.equal(todayKey(new Date(2026, 0, 5)), "20260105");
  assert.equal(todayKey(new Date(2026, 11, 31)), "20261231");
});

test("first order of a fresh day starts the sequence at 1", () => {
  const state = nextCounterState(null, new Date(2026, 0, 5));
  assert.deepEqual(state, { date: "20260105", seq: 1 });
});

test("same-day orders increment sequentially", () => {
  const day = new Date(2026, 0, 5);
  let state = nextCounterState(null, day);
  state = nextCounterState(state, day);
  state = nextCounterState(state, day);
  assert.deepEqual(state, { date: "20260105", seq: 3 });
});

test("a new day resets the sequence instead of continuing to climb", () => {
  const state = nextCounterState({ date: "20260105", seq: 47 }, new Date(2026, 0, 6));
  assert.deepEqual(state, { date: "20260106", seq: 1 });
});

test("order number formatting pads the sequence to 4 digits", () => {
  assert.equal(formatOrderNumber({ date: "20260105", seq: 1 }), "20260105-0001");
  assert.equal(formatOrderNumber({ date: "20260105", seq: 42 }), "20260105-0042");
  assert.equal(formatOrderNumber({ date: "20260105", seq: 12345 }), "20260105-12345");
});
