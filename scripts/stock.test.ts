/** Tests for piece-sold stock logic (run: npm run test:pos). */
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCountSummaryText,
  crossedLowThreshold,
  formatDelta,
  isLowStock,
  parseStockInput,
  quantitiesToReturn,
  saleQuantitiesByProduct,
} from "../src/lib/pos/stock";

test("sale quantities add up the same product across lines", () => {
  const totals = saleQuantitiesByProduct([
    { productId: "water", quantity: 2 },
    { productId: "coke", quantity: 1 },
    { productId: "water", quantity: 3 },
  ]);
  assert.equal(totals.get("water"), 5);
  assert.equal(totals.get("coke"), 1);
});

test("low threshold: alert only on the sale that crosses it", () => {
  assert.equal(crossedLowThreshold(6, 5, 5), true);
  assert.equal(crossedLowThreshold(8, 2, 5), true);
  assert.equal(crossedLowThreshold(5, 4, 5), false, "already low before this sale");
  assert.equal(crossedLowThreshold(10, 7, 5), false);
  assert.equal(isLowStock({ qty: 5, lowThreshold: 5 }), true);
  assert.equal(isLowStock({ qty: -1, lowThreshold: 0 }), true);
  assert.equal(isLowStock({ qty: 6, lowThreshold: 5 }), false);
});

test("input parsing: blank is 'not entered', only whole non-negative numbers count", () => {
  assert.deepEqual(parseStockInput(""), { ok: true, value: null });
  assert.deepEqual(parseStockInput(" 12 "), { ok: true, value: 12 });
  assert.deepEqual(parseStockInput("0"), { ok: true, value: 0 });
  assert.deepEqual(parseStockInput("-3"), { ok: false });
  assert.deepEqual(parseStockInput("1.5"), { ok: false });
  assert.deepEqual(parseStockInput("abc"), { ok: false });
});

test("delta wording", () => {
  assert.equal(formatDelta(0), "ตรง");
  assert.equal(formatDelta(2), "เกิน 2");
  assert.equal(formatDelta(-3), "ขาด 3");
});

test("count summary lists mismatches, tallies matches, appends low items", () => {
  const text = buildCountSummaryText(
    [
      { productName: "น้ำดื่ม", delta: -2, qtyAfter: 10, createdByName: "แอน" },
      { productName: "โค้ก", delta: 0, qtyAfter: 6, createdByName: "แอน" },
      { productName: "ขนม", delta: 0, qtyAfter: 3, createdByName: "แอน" },
    ],
    [{ productName: "ขนม", qty: 3 }]
  );
  assert.ok(text.includes("โดย แอน"));
  assert.ok(text.includes("น้ำดื่ม ขาด 2 (นับได้ 10)"));
  assert.ok(text.includes("ตรง 2 รายการ"));
  assert.ok(text.includes("ขนม เหลือ 3"));
  assert.ok(!text.includes("โค้ก ตรง"));
});

test("count summary when everything matched", () => {
  const text = buildCountSummaryText([{ productName: "น้ำดื่ม", delta: 0, qtyAfter: 10, createdByName: "แอน" }], []);
  assert.ok(text.includes("ตรงทุกรายการ"));
});

test("voiding returns exactly what the bill's sales took, per product", () => {
  const back = quantitiesToReturn([
    { productId: "water", delta: -2, type: "sale" },
    { productId: "coke", delta: -1, type: "sale" },
    { productId: "water", delta: -1, type: "sale" },
    { productId: "water", delta: 5, type: "receive" },
  ]);
  assert.equal(back.get("water"), 3);
  assert.equal(back.get("coke"), 1);
  assert.equal(back.size, 2);
});
