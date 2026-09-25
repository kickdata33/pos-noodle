/**
 * Tests for the ยอดขาย Delivery math (run: npm run test:pos).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { deliveryPayoutTotal, deliveryRangeSummary, deliverySalesByPlatform } from "../src/lib/pos/delivery";
import type { DeliveryPayout, Order, OrderItem, PaymentMethod } from "../src/types";

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

function makeOrder(overrides: Partial<Order> & Pick<Order, "id" | "total" | "paidAt">): Order {
  return {
    orderNumber: "20260101-0001",
    shopId: "shop1",
    orderType: "other",
    channelId: "ch-grab",
    channelName: "Grab",
    tableId: null,
    tableName: null,
    status: "PAID",
    items: [makeItem({ id: "i1", productId: "p1" })],
    subtotal: 60,
    discount: 0,
    serviceCharge: 0,
    tax: 0,
    createdBy: "u1",
    createdByName: "พนักงาน",
    createdAt: overrides.paidAt ?? Date.now(),
    updatedAt: overrides.paidAt ?? Date.now(),
    paymentStatus: "PAID",
    paymentMethodId: "delivery1",
    paymentMethodName: "Delivery",
    cashReceived: null,
    changeDue: null,
    ...overrides,
  };
}

function makePayout(overrides: Partial<DeliveryPayout> & Pick<DeliveryPayout, "id" | "platform" | "amount" | "dateKey">): DeliveryPayout {
  return {
    shopId: "shop1",
    note: "",
    createdBy: "u1",
    createdByName: "พนักงาน",
    createdAt: 0,
    ...overrides,
  };
}

const METHODS: PaymentMethod[] = [
  { id: "cash1", shopId: "shop1", name: "เงินสด", code: "cash", active: true, sortOrder: 1, createdAt: 0 },
  { id: "qr1", shopId: "shop1", name: "QR", code: "qr", active: true, sortOrder: 2, createdAt: 0 },
  { id: "delivery1", shopId: "shop1", name: "Delivery", code: "delivery", active: true, sortOrder: 3, createdAt: 0 },
];

// Bangkok midday on a given calendar date, well clear of any UTC/ICT day-boundary edge.
function bkkNoon(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 5, 0, 0); // 05:00 UTC = 12:00 ICT
}

test("deliverySalesByPlatform only counts orders paid via the delivery payment method", () => {
  const orders = [
    makeOrder({ id: "o1", total: 100, paidAt: bkkNoon("2026-01-10"), channelName: "Grab", paymentMethodId: "delivery1" }),
    // Same "Grab" channel but paid cash at the counter — must NOT count as delivery sales.
    makeOrder({ id: "o2", total: 999, paidAt: bkkNoon("2026-01-10"), channelName: "Grab", paymentMethodId: "cash1" }),
  ];
  const rows = deliverySalesByPlatform(orders, METHODS, "2026-01-10", "2026-01-10");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].byPlatform.grab, 100);
  assert.equal(rows[0].total, 100);
  assert.equal(rows[0].orderCount, 1);
});

test("deliverySalesByPlatform buckets by loose channel-name match and falls back to other", () => {
  const orders = [
    makeOrder({ id: "o1", total: 50, paidAt: bkkNoon("2026-01-10"), channelName: "LINE MAN", paymentMethodId: "delivery1" }),
    makeOrder({ id: "o2", total: 70, paidAt: bkkNoon("2026-01-10"), channelName: "ShopeeFood", paymentMethodId: "delivery1" }),
    makeOrder({ id: "o3", total: 30, paidAt: bkkNoon("2026-01-10"), channelName: "Robinhood", paymentMethodId: "delivery1" }),
  ];
  const rows = deliverySalesByPlatform(orders, METHODS, "2026-01-10", "2026-01-10");
  assert.equal(rows[0].byPlatform.lineman, 50);
  assert.equal(rows[0].byPlatform.shopeeFood, 70);
  assert.equal(rows[0].byPlatform.other, 30);
  assert.equal(rows[0].total, 150);
});

test("deliverySalesByPlatform groups by plain calendar dateKey, ignoring orders outside the range", () => {
  const orders = [
    makeOrder({ id: "o1", total: 100, paidAt: bkkNoon("2026-01-10"), channelName: "Grab", paymentMethodId: "delivery1" }),
    makeOrder({ id: "o2", total: 200, paidAt: bkkNoon("2026-01-11"), channelName: "Grab", paymentMethodId: "delivery1" }),
    // Outside the requested range entirely — must not appear anywhere in the result.
    makeOrder({ id: "o3", total: 9999, paidAt: bkkNoon("2026-01-20"), channelName: "Grab", paymentMethodId: "delivery1" }),
  ];
  const rows = deliverySalesByPlatform(orders, METHODS, "2026-01-10", "2026-01-11");
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.dateKey === "2026-01-10")?.byPlatform.grab, 100);
  assert.equal(rows.find((r) => r.dateKey === "2026-01-11")?.byPlatform.grab, 200);
});

test("deliveryPayoutTotal sums only the matching platform within the date range", () => {
  const payouts = [
    makePayout({ id: "p1", platform: "grab", amount: 500, dateKey: "2026-01-10" }),
    makePayout({ id: "p2", platform: "grab", amount: 300, dateKey: "2026-01-15" }),
    makePayout({ id: "p3", platform: "lineman", amount: 400, dateKey: "2026-01-10" }),
    // Outside the range — excluded.
    makePayout({ id: "p4", platform: "grab", amount: 999, dateKey: "2026-02-01" }),
  ];
  assert.equal(deliveryPayoutTotal(payouts, "grab", "2026-01-01", "2026-01-31"), 800);
  assert.equal(deliveryPayoutTotal(payouts, "lineman", "2026-01-01", "2026-01-31"), 400);
  assert.equal(deliveryPayoutTotal(payouts, "shopeeFood", "2026-01-01", "2026-01-31"), 0);
});

test("deliveryRangeSummary computes outstanding as sales minus payouts, per platform, and allows it to go negative", () => {
  const orders = [
    makeOrder({ id: "o1", total: 1000, paidAt: bkkNoon("2026-01-10"), channelName: "Grab", paymentMethodId: "delivery1" }),
  ];
  const rows = deliverySalesByPlatform(orders, METHODS, "2026-01-10", "2026-01-10");
  const payouts = [
    // A payout larger than sales-to-date — a rolling reserve settling a lump sum, not a bug.
    makePayout({ id: "p1", platform: "grab", amount: 1500, dateKey: "2026-01-10" }),
  ];
  const summary = deliveryRangeSummary(rows, payouts, "2026-01-10", "2026-01-10");
  const grab = summary.find((s) => s.platform === "grab");
  assert.equal(grab?.sales, 1000);
  assert.equal(grab?.payouts, 1500);
  assert.equal(grab?.outstanding, -500);

  const lineman = summary.find((s) => s.platform === "lineman");
  assert.equal(lineman?.sales, 0);
  assert.equal(lineman?.payouts, 0);
  assert.equal(lineman?.outstanding, 0);
});
