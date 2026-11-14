/** Tests for the bill-line kitchen status label (run: npm run test:pos). */
import assert from "node:assert/strict";
import test from "node:test";

import { lineKitchenStatus } from "../src/lib/pos/lineStatus";

test("kitchen-ticket shops: unsent lines say so", () => {
  assert.equal(lineKitchenStatus({ quantity: 2, kitchenSentQty: 1 }, true), "notSent");
  assert.equal(lineKitchenStatus({ quantity: 2, kitchenSentQty: 2 }, true), "cooking");
});

test("kitchen-screen shops: a new line is already with the kitchen", () => {
  assert.equal(lineKitchenStatus({ quantity: 1 }, false), "cooking");
});

test("a line whose category opts out of kitchen tickets never shows ยังไม่ส่งครัว", () => {
  assert.equal(lineKitchenStatus({ quantity: 2, kitchenSentQty: 0, sendToKitchen: false }, true), "cooking");
});

test("prepared and called-out lines", () => {
  assert.equal(lineKitchenStatus({ quantity: 1, prepared: true }, false), "ready");
  assert.equal(lineKitchenStatus({ quantity: 1, prepared: true, serveCalledAt: 5 }, true), "served");
});

test("table label never doubles the word โต๊ะ", async () => {
  const { tableLabel } = await import("../src/lib/tableLabel");
  assert.equal(tableLabel("3"), "โต๊ะ 3");
  assert.equal(tableLabel("โต๊ะ 1"), "โต๊ะ 1");
  assert.equal(tableLabel(" โต๊ะ VIP "), "โต๊ะ VIP");
  assert.equal(tableLabel("ห้อง 101"), "โต๊ะ ห้อง 101");
});
