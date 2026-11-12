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

test("prepared and called-out lines", () => {
  assert.equal(lineKitchenStatus({ quantity: 1, prepared: true }, false), "ready");
  assert.equal(lineKitchenStatus({ quantity: 1, prepared: true, serveCalledAt: 5 }, true), "served");
});
