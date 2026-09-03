/**
 * Tests for order pricing math (run: npm run test:pos).
 *
 * These are the numbers that end up on a customer's receipt, so every VAT/service-charge
 * combination is checked by hand-computed example rather than trusted to "look right".
 */
import assert from "node:assert/strict";
import test from "node:test";

import { computeLineTotal, computeOrderTotals, groupItemsByProduct } from "../src/lib/pos/pricing";
import type { OrderItem } from "../src/types";

function makeItem(overrides: Partial<OrderItem> & Pick<OrderItem, "id" | "productId">): OrderItem {
  return {
    productName: "ก๋วยเตี๋ยวหมู",
    quantity: 1,
    unitPrice: 60,
    modifiers: [],
    note: "",
    lineTotal: 60,
    ...overrides,
  };
}

test("line total is (unitPrice + modifiers) * quantity", () => {
  assert.equal(computeLineTotal(60, [], 1), 60);
  assert.equal(computeLineTotal(60, [], 2), 120);
  assert.equal(
    computeLineTotal(
      60,
      [
        { groupId: "g1", groupName: "เส้น", optionId: "o1", optionName: "หมี่ขาว", priceDelta: 0 },
        { groupId: "g2", groupName: "เพิ่มเติม", optionId: "o2", optionName: "เพิ่มลูกชิ้น", priceDelta: 10 },
      ],
      2
    ),
    140 // (60 + 0 + 10) * 2
  );
});

const noCharges = { vatEnabled: false, vatRate: 0, serviceChargeEnabled: false, serviceChargeRate: 0 };

test("no VAT, no service charge — total is just the subtotal", () => {
  const totals = computeOrderTotals([{ lineTotal: 100 }, { lineTotal: 50 }], noCharges);
  assert.deepEqual(totals, { subtotal: 150, discount: 0, serviceCharge: 0, tax: 0, total: 150 });
});

test("service charge only", () => {
  const settings = { ...noCharges, serviceChargeEnabled: true, serviceChargeRate: 10 };
  const totals = computeOrderTotals([{ lineTotal: 100 }], settings);
  assert.equal(totals.serviceCharge, 10);
  assert.equal(totals.tax, 0);
  assert.equal(totals.total, 110);
});

test("VAT only, computed on the subtotal", () => {
  const settings = { ...noCharges, vatEnabled: true, vatRate: 7 };
  const totals = computeOrderTotals([{ lineTotal: 100 }], settings);
  assert.equal(totals.tax, 7);
  assert.equal(totals.total, 107);
});

test("VAT is computed on subtotal + service charge (Thai restaurant convention)", () => {
  const settings = { vatEnabled: true, vatRate: 7, serviceChargeEnabled: true, serviceChargeRate: 10 };
  const totals = computeOrderTotals([{ lineTotal: 100 }], settings);
  assert.equal(totals.serviceCharge, 10);
  assert.equal(totals.tax, 7.7); // 7% of (100 - 0 + 10)
  assert.equal(totals.total, 117.7);
});

test("discount reduces the VAT base and the total, but not the displayed subtotal", () => {
  const settings = { vatEnabled: true, vatRate: 7, serviceChargeEnabled: false, serviceChargeRate: 0 };
  const totals = computeOrderTotals([{ lineTotal: 100 }], settings, 20);
  assert.equal(totals.subtotal, 100);
  assert.equal(totals.discount, 20);
  assert.equal(totals.tax, 5.6); // 7% of (100 - 20 + 0)
  assert.equal(totals.total, 85.6);
});

test("rounds to 2 decimal places to avoid floating-point noise", () => {
  const settings = { vatEnabled: true, vatRate: 7, serviceChargeEnabled: true, serviceChargeRate: 10 };
  const totals = computeOrderTotals([{ lineTotal: 33.33 }], settings);
  assert.equal(Number.isFinite(totals.total), true);
  assert.equal(totals.total, Math.round(totals.total * 100) / 100);
});

test("groupItemsByProduct: a single line of a product stays its own group of one", () => {
  const items = [makeItem({ id: "a", productId: "p1" })];
  const groups = groupItemsByProduct(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].totalQty, 1);
  assert.deepEqual(groups[0].items, items);
});

test("groupItemsByProduct: same product added in separate taps with different notes merges into one group", () => {
  const items = [
    makeItem({ id: "a", productId: "p1", note: "ไม่งอก" }),
    makeItem({ id: "b", productId: "p1", note: "ไม่ผัก" }),
  ];
  const groups = groupItemsByProduct(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].productName, "ก๋วยเตี๋ยวหมู");
  assert.equal(groups[0].totalQty, 2); // headline qty is a sum, even though each line is qty 1
  assert.deepEqual(
    groups[0].items.map((i) => i.note),
    ["ไม่งอก", "ไม่ผัก"] // each line's own note survives — nothing is lost by grouping
  );
});

test("groupItemsByProduct: a line's own quantity contributes to the group total, not just line count", () => {
  const items = [
    makeItem({ id: "a", productId: "p1", quantity: 3, lineTotal: 180 }),
    makeItem({ id: "b", productId: "p1", quantity: 2, lineTotal: 120, note: "ไม่ผัก" }),
  ];
  const groups = groupItemsByProduct(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].totalQty, 5);
});

test("groupItemsByProduct: different products never merge, and group order follows first appearance", () => {
  const items = [
    makeItem({ id: "a", productId: "p1", productName: "ก๋วยเตี๋ยวหมู" }),
    makeItem({ id: "b", productId: "p2", productName: "น้ำเปล่า" }),
    makeItem({ id: "c", productId: "p1", productName: "ก๋วยเตี๋ยวหมู" }),
  ];
  const groups = groupItemsByProduct(items);
  assert.deepEqual(
    groups.map((g) => g.productId),
    ["p1", "p2"]
  );
  assert.equal(groups[0].totalQty, 2);
  assert.equal(groups[1].totalQty, 1);
});
