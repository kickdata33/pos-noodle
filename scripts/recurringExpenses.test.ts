/**
 * Tests for `computeMissingRecurringExpenses` (run: npm run test:pos) — the pure decision logic
 * behind auto-creating each day's row for a recurring expense (rent/wages/internet).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  computeMissingRecurringExpenses,
  recurringExpenseDayKey,
  type RecurringExpenseTemplateForGen,
} from "../src/lib/pos/recurringExpenses";

function template(overrides: Partial<RecurringExpenseTemplateForGen> = {}): RecurringExpenseTemplateForGen {
  return {
    id: "rent",
    shopId: "shop1",
    category: "เช่าที่",
    description: "ค่าที่",
    amount: 250,
    paymentMethod: "cash",
    active: true,
    createdDateKey: "2026-09-01",
    ...overrides,
  };
}

test("computeMissingRecurringExpenses: generates one row per active template per day with nothing existing/skipped", () => {
  const result = computeMissingRecurringExpenses([template()], new Set(), new Set(), ["2026-09-10", "2026-09-11"]);
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((r) => r.dateKey),
    ["2026-09-10", "2026-09-11"]
  );
  assert.equal(result[0].recurringExpenseId, "rent");
  assert.equal(result[0].amount, 250);
});

test("computeMissingRecurringExpenses: skips a day that already has an Expense", () => {
  const existing = new Set([recurringExpenseDayKey("rent", "2026-09-10")]);
  const result = computeMissingRecurringExpenses([template()], existing, new Set(), ["2026-09-10", "2026-09-11"]);
  assert.deepEqual(
    result.map((r) => r.dateKey),
    ["2026-09-11"]
  );
});

test("computeMissingRecurringExpenses: skips a day explicitly marked skipped (a day off)", () => {
  const skipped = new Set([recurringExpenseDayKey("rent", "2026-09-10")]);
  const result = computeMissingRecurringExpenses([template()], new Set(), skipped, ["2026-09-10", "2026-09-11"]);
  assert.deepEqual(
    result.map((r) => r.dateKey),
    ["2026-09-11"]
  );
});

test("computeMissingRecurringExpenses: never backfills before the template's own createdDateKey", () => {
  const result = computeMissingRecurringExpenses(
    [template({ createdDateKey: "2026-09-11" })],
    new Set(),
    new Set(),
    ["2026-09-10", "2026-09-11", "2026-09-12"]
  );
  assert.deepEqual(
    result.map((r) => r.dateKey),
    ["2026-09-11", "2026-09-12"]
  );
});

test("computeMissingRecurringExpenses: an inactive template generates nothing", () => {
  const result = computeMissingRecurringExpenses([template({ active: false })], new Set(), new Set(), ["2026-09-10"]);
  assert.equal(result.length, 0);
});

test("computeMissingRecurringExpenses: multiple templates generate independently", () => {
  const result = computeMissingRecurringExpenses(
    [template({ id: "rent", amount: 250 }), template({ id: "net", amount: 22, category: "ค่าเน็ต" })],
    new Set(),
    new Set(),
    ["2026-09-10"]
  );
  assert.equal(result.length, 2);
  assert.ok(result.some((r) => r.recurringExpenseId === "rent" && r.amount === 250));
  assert.ok(result.some((r) => r.recurringExpenseId === "net" && r.amount === 22));
});

test("computeMissingRecurringExpenses: is safe to call repeatedly over an overlapping window (idempotent)", () => {
  const t = template();
  const first = computeMissingRecurringExpenses([t], new Set(), new Set(), ["2026-09-10", "2026-09-11"]);
  const existingAfterFirstRun = new Set(first.map((r) => recurringExpenseDayKey(r.recurringExpenseId, r.dateKey)));
  const second = computeMissingRecurringExpenses(
    [t],
    existingAfterFirstRun,
    new Set(),
    ["2026-09-10", "2026-09-11", "2026-09-12"]
  );
  assert.deepEqual(
    second.map((r) => r.dateKey),
    ["2026-09-12"]
  );
});
