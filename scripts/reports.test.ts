/**
 * Tests for the sales report's date math (run: npm run test:pos).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  addDaysToKey,
  bangkokDateKey,
  bangkokHour,
  bangkokWeekday,
  customRange,
  dateKeysBetween,
  resolvePreset,
} from "../src/lib/pos/dateRange";
import {
  dailySales,
  hourlySales,
  salesByChannel,
  salesByPaymentMethod,
  summarizeOrders,
  topProducts,
} from "../src/lib/pos/reports";
import type { Order, OrderItem } from "../src/types";

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
    orderType: "dineIn",
    channelId: "ch1",
    channelName: "หน้าร้าน",
    tableId: "t1",
    tableName: "โต๊ะ 1",
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
    paymentMethodId: "pm1",
    paymentMethodName: "เงินสด",
    cashReceived: null,
    changeDue: null,
    ...overrides,
  };
}

// --- dateRange -------------------------------------------------------------------------------

test("bangkokDateKey: UTC midnight is still 'yesterday evening' in Bangkok (UTC+7) — except at 17:00 UTC", () => {
  // 2026-01-01T00:00:00Z is 2026-01-01 07:00 in Bangkok — same calendar day.
  assert.equal(bangkokDateKey(Date.UTC(2026, 0, 1, 0, 0, 0)), "2026-01-01");
  // 2026-01-01T16:59:59Z is still 2026-01-01 23:59:59 Bangkok.
  assert.equal(bangkokDateKey(Date.UTC(2026, 0, 1, 16, 59, 59)), "2026-01-01");
  // 2026-01-01T17:00:00Z rolls over to 2026-01-02 00:00:00 Bangkok.
  assert.equal(bangkokDateKey(Date.UTC(2026, 0, 1, 17, 0, 0)), "2026-01-02");
});

test("bangkokHour: matches the Bangkok wall-clock hour, not the UTC hour", () => {
  assert.equal(bangkokHour(Date.UTC(2026, 0, 1, 5, 30)), 12); // 05:30 UTC -> 12:30 Bangkok
  assert.equal(bangkokHour(Date.UTC(2026, 0, 1, 17, 0)), 0); // rolls to next day, hour 0
});

test("bangkokWeekday: Monday is 0, Sunday is 6", () => {
  // 2026-01-05 is a Monday.
  assert.equal(bangkokWeekday(Date.UTC(2026, 0, 5, 3)), 0);
  assert.equal(bangkokWeekday(Date.UTC(2026, 0, 11, 3)), 6); // the following Sunday
});

test("addDaysToKey / dateKeysBetween round-trip across a month boundary", () => {
  assert.equal(addDaysToKey("2026-01-31", 1), "2026-02-01");
  assert.deepEqual(dateKeysBetween("2026-01-30", "2026-02-01"), ["2026-01-30", "2026-01-31", "2026-02-01"]);
});

test("resolvePreset: 'today' and 'thisWeek' anchor correctly to a known Wednesday", () => {
  // 2026-01-07 12:00 Bangkok is a Wednesday.
  const now = Date.UTC(2026, 0, 7, 5, 0);
  assert.deepEqual(resolvePreset("today", now), resolvePreset("today", now)); // idempotent
  const today = resolvePreset("today", now);
  assert.equal(today.startKey, "2026-01-07");
  assert.equal(today.endKey, "2026-01-07");

  const week = resolvePreset("thisWeek", now);
  assert.equal(week.startKey, "2026-01-05"); // Monday
  assert.equal(week.endKey, "2026-01-11"); // Sunday

  const last7 = resolvePreset("last7", now);
  assert.equal(last7.startKey, "2026-01-01");
  assert.equal(last7.endKey, "2026-01-07");
});

test("customRange swaps an inverted from/to instead of returning an empty range", () => {
  const range = customRange("2026-01-10", "2026-01-01");
  assert.equal(range.startKey, "2026-01-01");
  assert.equal(range.endKey, "2026-01-10");
});

// --- reports -----------------------------------------------------------------------------------

test("summarizeOrders: revenue/orderCount/itemCount/avg", () => {
  const orders = [
    makeOrder({ id: "o1", total: 100, paidAt: 1, items: [makeItem({ id: "i1", productId: "p1", quantity: 2 })] }),
    makeOrder({ id: "o2", total: 50, paidAt: 2, items: [makeItem({ id: "i2", productId: "p1", quantity: 1 })] }),
  ];
  const summary = summarizeOrders(orders);
  assert.equal(summary.revenue, 150);
  assert.equal(summary.orderCount, 2);
  assert.equal(summary.itemCount, 3);
  assert.equal(summary.avgOrderValue, 75);
});

test("summarizeOrders: empty range never divides by zero", () => {
  assert.deepEqual(summarizeOrders([]), { revenue: 0, orderCount: 0, itemCount: 0, avgOrderValue: 0 });
});

test("topProducts: aggregates quantity and revenue across orders, sorted by qty desc", () => {
  const orders = [
    makeOrder({
      id: "o1",
      total: 180,
      paidAt: 1,
      items: [
        makeItem({ id: "i1", productId: "p1", productName: "ก๋วยเตี๋ยวหมู", quantity: 2, lineTotal: 120 }),
        makeItem({ id: "i2", productId: "p2", productName: "น้ำเปล่า", quantity: 1, lineTotal: 20 }),
      ],
    }),
    makeOrder({
      id: "o2",
      total: 60,
      paidAt: 2,
      items: [makeItem({ id: "i3", productId: "p1", productName: "ก๋วยเตี๋ยวหมู", quantity: 1, lineTotal: 60 })],
    }),
  ];
  const top = topProducts(orders);
  assert.equal(top[0].productId, "p1");
  assert.equal(top[0].qty, 3);
  assert.equal(top[0].revenue, 180);
  assert.equal(top[1].productId, "p2");
});

test("dailySales: fills every day in range, including zero-revenue days", () => {
  const orders = [makeOrder({ id: "o1", total: 100, paidAt: Date.UTC(2026, 0, 2, 3) })]; // Jan 2 Bangkok
  const days = dailySales(orders, "2026-01-01", "2026-01-03");
  assert.equal(days.length, 3);
  assert.deepEqual(
    days.map((d) => d.dateKey),
    ["2026-01-01", "2026-01-02", "2026-01-03"]
  );
  assert.equal(days[0].revenue, 0);
  assert.equal(days[1].revenue, 100);
  assert.equal(days[1].orderCount, 1);
});

test("hourlySales: buckets by Bangkok hour, all 24 hours present", () => {
  const orders = [
    makeOrder({ id: "o1", total: 100, paidAt: Date.UTC(2026, 0, 1, 5, 0) }), // 12:00 Bangkok
    makeOrder({ id: "o2", total: 50, paidAt: Date.UTC(2026, 0, 1, 5, 30) }), // still 12:xx Bangkok
  ];
  const hours = hourlySales(orders);
  assert.equal(hours.length, 24);
  assert.equal(hours[12].orderCount, 2);
  assert.equal(hours[12].revenue, 150);
  assert.equal(hours[0].orderCount, 0);
});

test("salesByChannel / salesByPaymentMethod: grouped and sorted by revenue desc", () => {
  const orders = [
    makeOrder({ id: "o1", total: 100, paidAt: 1, channelId: "c1", channelName: "หน้าร้าน" }),
    makeOrder({ id: "o2", total: 300, paidAt: 2, channelId: "c2", channelName: "Grab" }),
    makeOrder({ id: "o3", total: 50, paidAt: 3, channelId: "c1", channelName: "หน้าร้าน" }),
  ];
  const byChannel = salesByChannel(orders);
  assert.equal(byChannel[0].label, "Grab");
  assert.equal(byChannel[0].revenue, 300);
  assert.equal(byChannel[1].label, "หน้าร้าน");
  assert.equal(byChannel[1].revenue, 150);
  assert.equal(byChannel[1].orderCount, 2);

  const byPayment = salesByPaymentMethod(orders);
  assert.equal(byPayment[0].label, "เงินสด");
  assert.equal(byPayment[0].revenue, 450);
});
