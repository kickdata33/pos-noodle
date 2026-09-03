/**
 * Tests for order pricing math (run: npm run test:pos).
 *
 * These are the numbers that end up on a customer's receipt, so every VAT/service-charge
 * combination is checked by hand-computed example rather than trusted to "look right".
 */
import assert from "node:assert/strict";
import test from "node:test";

import { computeLineTotal, computeOrderTotals } from "../src/lib/pos/pricing";

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
