/**
 * Tests for order pricing math (run: npm run test:pos).
 *
 * These are the numbers that end up on a customer's receipt, so every VAT/service-charge
 * combination is checked by hand-computed example rather than trusted to "look right".
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  computeLineTotal,
  computeOrderTotals,
  distributeTieredPriceDeltas,
  groupItemsByProduct,
  resolveChannelPrice,
  resolveTieredGroupPrice,
  resolveTimeBasedPrice,
} from "../src/lib/pos/pricing";
import type { OrderItem, Product, SalesChannel } from "../src/types";

/** Epoch ms whose Bangkok clock time is exactly `hh:mm` on an arbitrary fixed date. */
function bkk(hh: number, mm: number): number {
  return Date.UTC(2026, 0, 1, (hh - 7 + 24) % 24, mm);
}

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
  assert.deepEqual(totals, { subtotal: 150, discount: 0, promoDiscount: 0, serviceCharge: 0, tax: 0, total: 150 });
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

// --- resolveChannelPrice (item 23: channel price markup, e.g. Grab/LINE MAN/ShopeeFood) ---

function testProduct(overrides: Partial<Pick<Product, "price" | "channelPrices">> = {}): Pick<Product, "price" | "channelPrices"> {
  return { price: 60, ...overrides };
}

function testChannel(overrides: Partial<Pick<SalesChannel, "id" | "markupPercent">> = {}): Pick<SalesChannel, "id" | "markupPercent"> {
  return { id: "grab", ...overrides };
}

test("resolveChannelPrice: no channel falls straight through to the plain price", () => {
  assert.equal(resolveChannelPrice(testProduct({ price: 60 }), null), 60);
});

test("resolveChannelPrice: a channel with no markup set falls straight through to the plain price", () => {
  assert.equal(resolveChannelPrice(testProduct({ price: 60 }), testChannel({ markupPercent: undefined })), 60);
  assert.equal(resolveChannelPrice(testProduct({ price: 60 }), testChannel({ markupPercent: 0 })), 60);
});

test("resolveChannelPrice: applies the channel's markup percent, rounded UP to the nearest 5 baht", () => {
  // 60 + 20% = 72 -> rounds up to 75
  assert.equal(resolveChannelPrice(testProduct({ price: 60 }), testChannel({ markupPercent: 20 })), 75);
  // 60 + 25% = 75 exactly -> stays 75, never rounds further up past an exact multiple of 5
  assert.equal(resolveChannelPrice(testProduct({ price: 60 }), testChannel({ markupPercent: 25 })), 75);
  // 60 + 15% = 69 -> rounds up to 70
  assert.equal(resolveChannelPrice(testProduct({ price: 60 }), testChannel({ markupPercent: 15 })), 70);
});

test("resolveChannelPrice: a manual per-item channelPrices override always wins over the percent markup", () => {
  const product = testProduct({ price: 60, channelPrices: { grab: 65 } });
  assert.equal(resolveChannelPrice(product, testChannel({ id: "grab", markupPercent: 20 })), 65);
  // A different channel with no override still gets the automatic markup.
  assert.equal(resolveChannelPrice(product, testChannel({ id: "lineman", markupPercent: 20 })), 75);
});

test("resolveChannelPrice: an override of exactly 0 is a real override, not treated as unset", () => {
  const product = testProduct({ price: 60, channelPrices: { grab: 0 } });
  assert.equal(resolveChannelPrice(product, testChannel({ id: "grab", markupPercent: 20 })), 0);
});

// --- resolveTimeBasedPrice / Product.timePrices (single-item time-based special price) ---

test("resolveTimeBasedPrice: no rules at all falls straight through to the plain price", () => {
  assert.equal(resolveTimeBasedPrice({ price: 60, timePrices: null }, bkk(21, 0)), 60);
  assert.equal(resolveTimeBasedPrice({ price: 60, timePrices: [] }, bkk(21, 0)), 60);
});

test("resolveTimeBasedPrice: a rule's price replaces the plain price while its window is active", () => {
  const product = { price: 650, timePrices: [{ price: 599, fromTime: "20:00", toTime: "23:00" }] };
  assert.equal(resolveTimeBasedPrice(product, bkk(21, 0)), 599); // inside the window
  assert.equal(resolveTimeBasedPrice(product, bkk(20, 0)), 599); // fromTime is inclusive
  assert.equal(resolveTimeBasedPrice(product, bkk(19, 59)), 650); // just before
  assert.equal(resolveTimeBasedPrice(product, bkk(23, 0)), 650); // toTime is exclusive
});

test("resolveTimeBasedPrice: a rule may raise the price too, not just discount it (a time surcharge is allowed)", () => {
  const product = { price: 60, timePrices: [{ price: 80, fromTime: "22:00", toTime: "02:00" }] };
  assert.equal(resolveTimeBasedPrice(product, bkk(23, 0)), 80); // window crosses midnight
  assert.equal(resolveTimeBasedPrice(product, bkk(1, 0)), 80);
  assert.equal(resolveTimeBasedPrice(product, bkk(12, 0)), 60);
});

test("resolveTimeBasedPrice: outside every rule's window falls back to the plain price", () => {
  const product = {
    price: 60,
    timePrices: [
      { price: 50, fromTime: "11:00", toTime: "14:00" },
      { price: 55, fromTime: "17:00", toTime: "20:00" },
    ],
  };
  assert.equal(resolveTimeBasedPrice(product, bkk(12, 0)), 50);
  assert.equal(resolveTimeBasedPrice(product, bkk(18, 0)), 55);
  assert.equal(resolveTimeBasedPrice(product, bkk(15, 0)), 60);
});

test("resolveChannelPrice: no channel at all applies the time-based price (dine-in draft still resolving its channel)", () => {
  const product = { price: 650, channelPrices: {}, timePrices: [{ price: 599, fromTime: "20:00", toTime: "23:00" }] };
  assert.equal(resolveChannelPrice(product, null, bkk(21, 0)), 599);
  assert.equal(resolveChannelPrice(product, null, bkk(12, 0)), 650);
});

test("resolveChannelPrice: a real channel with no markup and no override is the plain storefront case too — time price still applies (e.g. the dine-in channel itself)", () => {
  const product = { price: 650, channelPrices: {}, timePrices: [{ price: 599, fromTime: "20:00", toTime: "23:00" }] };
  const dineIn = testChannel({ id: "dine-in", markupPercent: 0 });
  assert.equal(resolveChannelPrice(product, dineIn, bkk(21, 0)), 599);
  assert.equal(resolveChannelPrice(product, dineIn, bkk(12, 0)), 650);
});

test("resolveChannelPrice: a channel with an actual markup ignores the time-based price — it marks up the plain price only", () => {
  const product = { price: 650, channelPrices: {}, timePrices: [{ price: 599, fromTime: "20:00", toTime: "23:00" }] };
  const grab = testChannel({ id: "grab", markupPercent: 20 });
  // 650 + 20% = 780 exactly -> stays 780, never discounted by the dine-in happy-hour rule.
  assert.equal(resolveChannelPrice(product, grab, bkk(21, 0)), 780);
});

test("resolveChannelPrice: a channel with its own per-item override ignores the time-based price too — the override is literal", () => {
  const product = { price: 650, channelPrices: { grab: 700 }, timePrices: [{ price: 599, fromTime: "20:00", toTime: "23:00" }] };
  const grab = testChannel({ id: "grab", markupPercent: 20 });
  assert.equal(resolveChannelPrice(product, grab, bkk(21, 0)), 700);
});

test("resolveChannelPrice: `now` defaults to the current time when omitted, so every existing caller keeps working unchanged", () => {
  // No timePrices set at all (every product before this field existed) — the default `now` can
  // never matter, since resolveTimeBasedPrice always falls through to the plain price either way.
  assert.equal(resolveChannelPrice(testProduct({ price: 60 }), null), 60);
});

test("resolveTieredGroupPrice: exact match per the meat-topping example — 1/2 อย่าง 50, 3 อย่าง 60", () => {
  const tiers = [
    { count: 1, price: 50 },
    { count: 2, price: 50 },
    { count: 3, price: 60 },
  ];
  assert.equal(resolveTieredGroupPrice(tiers, 1), 50);
  assert.equal(resolveTieredGroupPrice(tiers, 2), 50);
  assert.equal(resolveTieredGroupPrice(tiers, 3), 60);
});

test("resolveTieredGroupPrice: 0 selected, no tiers, or a count with no matching/lower tier all price at 0", () => {
  const tiers = [{ count: 2, price: 50 }];
  assert.equal(resolveTieredGroupPrice(tiers, 0), 0);
  assert.equal(resolveTieredGroupPrice(undefined, 2), 0);
  assert.equal(resolveTieredGroupPrice(tiers, 1), 0); // no tier <= 1
});

test("resolveTieredGroupPrice: an incomplete tier list falls back to the closest lower tier, not 0", () => {
  const tiers = [
    { count: 1, price: 40 },
    { count: 3, price: 60 },
  ];
  // count 2 has no exact tier — falls back to the count-1 tier (40), never silently 0.
  assert.equal(resolveTieredGroupPrice(tiers, 2), 40);
});

test("distributeTieredPriceDeltas: whole tier price lands on the last option, others get 0", () => {
  assert.deepEqual(distributeTieredPriceDeltas(1, 50), [50]);
  assert.deepEqual(distributeTieredPriceDeltas(2, 50), [0, 50]);
  assert.deepEqual(distributeTieredPriceDeltas(3, 60), [0, 0, 60]);
  // Sum always equals the tier price, regardless of count.
  for (const [count, price] of [[1, 50], [2, 50], [3, 60]] as const) {
    const deltas = distributeTieredPriceDeltas(count, price);
    assert.equal(deltas.reduce((a, b) => a + b, 0), price);
  }
});
