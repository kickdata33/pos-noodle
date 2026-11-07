/** Tests for quantity deals and staff-only items (run: npm run test:pos). */
import assert from "node:assert/strict";
import test from "node:test";

import { resolveCustomerOrderItem } from "../src/lib/pos/customerOrder";
import { bundleDealsForLine, computeOrderTotals, computePromotionDiscount } from "../src/lib/pos/pricing";
import type { OrderItem, Product } from "../src/types";

const beerDeals = [{ qty: 3, price: 200 }];
function beer(id: string, quantity: number, unitPrice = 79, deals = beerDeals): OrderItem {
  return {
    id,
    productId: "beer",
    productName: "เบียร์",
    quantity,
    unitPrice,
    modifiers: [],
    note: "",
    lineTotal: unitPrice * quantity,
    bundleDeals: deals,
  };
}

test("3 bottles for 200 when one is 79 → saves 37", () => {
  assert.equal(computePromotionDiscount([beer("a", 3)]), 37);
});

test("separate taps pool into one deal", () => {
  assert.equal(computePromotionDiscount([beer("a", 1), beer("b", 1), beer("c", 1)]), 37);
});

test("leftover bottles pay normal price", () => {
  assert.equal(computePromotionDiscount([beer("a", 4)]), 37);
  assert.equal(computePromotionDiscount([beer("a", 7)]), 74);
  assert.equal(computePromotionDiscount([beer("a", 2)]), 0);
});

test("biggest deal first, then smaller ones", () => {
  const deals = [
    { qty: 3, price: 200 },
    { qty: 6, price: 380 },
  ];
  // 7 bottles: one 6-pack deal (474 → 380 saves 94), 1 left at normal price.
  assert.equal(computePromotionDiscount([beer("a", 7, 79, deals)]), 94);
  // 9 bottles: 6-deal + 3-deal = 94 + 37.
  assert.equal(computePromotionDiscount([beer("a", 9, 79, deals)]), 131);
});

test("a deal that isn't cheaper is ignored", () => {
  assert.equal(computePromotionDiscount([beer("a", 3, 79, [{ qty: 3, price: 240 }])]), 0);
});

test("lines at a different price (delivery markup) are not pooled with in-store ones", () => {
  assert.equal(computePromotionDiscount([beer("a", 2), beer("b", 1, 95)]), 0);
});

test("totals subtract the promotion and report it separately", () => {
  const settings = { vatEnabled: false, vatRate: 0, serviceChargeEnabled: false, serviceChargeRate: 0 };
  const totals = computeOrderTotals([beer("a", 3)], settings);
  assert.equal(totals.subtotal, 237);
  assert.equal(totals.promoDiscount, 37);
  assert.equal(totals.discount, 37);
  assert.equal(totals.total, 200);
});

test("deals are only snapshotted at the normal price", () => {
  const product = { price: 79, bundleDeals: beerDeals };
  assert.deepEqual(bundleDealsForLine(product, 79), { bundleDeals: beerDeals });
  assert.deepEqual(bundleDealsForLine(product, 95), {});
  assert.deepEqual(bundleDealsForLine({ price: 79 }, 79), {});
});

test("customer orders can't include staff-only items", () => {
  const product = {
    id: "beer",
    shopId: "s",
    categoryId: "c",
    name: "เบียร์",
    price: 79,
    modifierGroupIds: [],
    active: true,
    staffOnly: true,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  } as Product;
  const result = resolveCustomerOrderItem(
    { productId: "beer", quantity: 1, optionIds: [], note: "" },
    { products: [product], modifierGroups: [], modifierOptions: [] }
  );
  assert.equal(result.ok, false);
});

test("time windows: before/after 20:00 and across midnight", async () => {
  const { isDealActiveAt, dealWindowsOverlap, dealWindowLabel } = await import("../src/lib/pos/pricing");
  const at = (h: number, m = 0) => h * 60 + m;
  const before8 = { toTime: "20:00" };
  const after8 = { fromTime: "20:00" };
  assert.equal(isDealActiveAt(before8, at(19, 59)), true);
  assert.equal(isDealActiveAt(before8, at(20, 0)), false);
  assert.equal(isDealActiveAt(after8, at(20, 0)), true);
  assert.equal(isDealActiveAt(after8, at(23, 59)), true);
  const lateNight = { fromTime: "20:00", toTime: "02:00" };
  assert.equal(isDealActiveAt(lateNight, at(1, 30)), true);
  assert.equal(isDealActiveAt(lateNight, at(2, 0)), false);
  assert.equal(isDealActiveAt({}, at(12)), true, "no window = all day");
  assert.equal(dealWindowsOverlap(before8, after8), false);
  assert.equal(dealWindowsOverlap({}, after8), true);
  assert.equal(dealWindowLabel(before8), "ก่อน 20:00");
  assert.equal(dealWindowLabel(after8), "ตั้งแต่ 20:00");
  assert.equal(dealWindowLabel({}), "");
});

test("a line gets the deal running when it's added (shop time), and windows don't pool", () => {
  const product = {
    price: 89,
    bundleDeals: [
      { qty: 3, price: 189, toTime: "20:00" },
      { qty: 3, price: 219, fromTime: "20:00" },
    ],
  };
  // 12:00 UTC = 19:00 Bangkok; 13:30 UTC = 20:30 Bangkok.
  const evening = Date.UTC(2026, 10, 7, 12, 0);
  const late = Date.UTC(2026, 10, 7, 13, 30);
  const early = bundleDealsForLine(product, 89, evening).bundleDeals!;
  const after = bundleDealsForLine(product, 89, late).bundleDeals!;
  assert.deepEqual(early.map((d) => d.price), [189]);
  assert.deepEqual(after.map((d) => d.price), [219]);

  const line = (id: string, qty: number, deals: typeof early): OrderItem => ({
    id,
    productId: "beer",
    productName: "เบียร์",
    quantity: qty,
    unitPrice: 89,
    modifiers: [],
    note: "",
    lineTotal: 89 * qty,
    bundleDeals: deals,
  });
  assert.equal(computePromotionDiscount([line("a", 3, early)]), 267 - 189);
  assert.equal(computePromotionDiscount([line("a", 3, after)]), 267 - 219);
  // 2 bottles before 20:00 + 1 after: no window has 3 → no deal.
  assert.equal(computePromotionDiscount([line("a", 2, early), line("b", 1, after)]), 0);
});
