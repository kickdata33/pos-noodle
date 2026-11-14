/**
 * Tests for the kitchen screen's alert/badge logic and the "more portions of a done line" split
 * (run: npm run test:pos).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  detectNewKitchenItems,
  increaseItemQuantity,
  isNewKitchenItem,
  KITCHEN_NEW_ITEM_WINDOW_MS,
} from "../src/lib/pos/kitchenAlerts";
import type { OrderItem } from "../src/types";

function item(overrides: Partial<OrderItem> & Pick<OrderItem, "id">): OrderItem {
  return {
    productId: "p",
    productName: "ก๋วยเตี๋ยวหมู",
    quantity: 1,
    unitPrice: 50,
    modifiers: [],
    note: "",
    lineTotal: 50,
    ...overrides,
  };
}

const lineTotal = (unitPrice: number, _m: OrderItem["modifiers"], qty: number) => unitPrice * qty;

test("first snapshot never alerts, even with unprepared items waiting", () => {
  const r = detectNewKitchenItems(null, [{ items: [item({ id: "a" })] }]);
  assert.equal(r.hasNew, false);
  assert.ok(r.seen.has("a"));
});

test("a new unprepared line alerts — whoever added it", () => {
  const r = detectNewKitchenItems(new Set(["a"]), [{ items: [item({ id: "a" }), item({ id: "b" })] }]);
  assert.equal(r.hasNew, true);
});

test("a new order on another table alerts", () => {
  const r = detectNewKitchenItems(new Set(["a"]), [{ items: [item({ id: "a" })] }, { items: [item({ id: "c" })] }]);
  assert.equal(r.hasNew, true);
});

test("toggling a seen line back to not-done does not alert", () => {
  const r = detectNewKitchenItems(new Set(["a"]), [{ items: [item({ id: "a", prepared: false })] }]);
  assert.equal(r.hasNew, false);
});

test("'ใหม่' badge only for recent, unprepared lines with a known add time", () => {
  const now = 1_000_000;
  assert.equal(isNewKitchenItem({ addedAt: now - 60_000 }, now), true);
  assert.equal(isNewKitchenItem({ addedAt: now - KITCHEN_NEW_ITEM_WINDOW_MS - 1 }, now), false);
  assert.equal(isNewKitchenItem({ addedAt: now - 60_000, prepared: true }, now), false);
  assert.equal(isNewKitchenItem({}, now), false);
});

test("raising quantity on a done line adds a separate fresh line instead", () => {
  const done = item({ id: "a", quantity: 2, lineTotal: 100, prepared: true, kitchenSentQty: 2 });
  const result = increaseItemQuantity([done], done, 1, "new", 5, lineTotal);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], done);
  assert.equal(result[1].id, "new");
  assert.equal(result[1].quantity, 1);
  assert.equal(result[1].lineTotal, 50);
  assert.equal(result[1].prepared, undefined);
  assert.equal(result[1].kitchenSentQty, undefined);
  assert.equal(result[1].addedAt, 5);
});

test("raising quantity on a done line carries sendToKitchen: false forward onto the split-off line", () => {
  const done = item({ id: "a", quantity: 2, lineTotal: 100, prepared: true, kitchenSentQty: 2, sendToKitchen: false });
  const result = increaseItemQuantity([done], done, 1, "new", 5, lineTotal);
  assert.equal(result[1].sendToKitchen, false);
});

test("raising quantity on a line not yet done bumps it in place", () => {
  const pending = item({ id: "a", quantity: 1 });
  const result = increaseItemQuantity([pending], pending, 2, "new", 5, lineTotal);
  assert.equal(result.length, 1);
  assert.equal(result[0].quantity, 3);
  assert.equal(result[0].lineTotal, 150);
});
