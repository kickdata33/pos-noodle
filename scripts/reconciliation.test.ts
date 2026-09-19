/**
 * Tests for the bank-reconciliation math (run: npm run test:pos).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  businessDayBounds,
  businessDaySales,
  expensesForDay,
  reconciliationRows,
  transfersForBusinessDay,
} from "../src/lib/pos/reconciliation";
import type { BankTransfer, Expense, Order, OrderItem, PaymentMethod } from "../src/types";

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
    paymentMethodId: "cash1",
    paymentMethodName: "เงินสด",
    cashReceived: null,
    changeDue: null,
    ...overrides,
  };
}

const METHODS: PaymentMethod[] = [
  { id: "cash1", shopId: "shop1", name: "เงินสด", code: "cash", active: true, sortOrder: 1, createdAt: 0 },
  { id: "qr1", shopId: "shop1", name: "QR", code: "qr", active: true, sortOrder: 2, createdAt: 0 },
  { id: "delivery1", shopId: "shop1", name: "Delivery", code: "delivery", active: true, sortOrder: 3, createdAt: 0 },
];

function makeTransfer(
  overrides: Partial<BankTransfer> & Pick<BankTransfer, "id" | "transferredAt" | "amount" | "businessDayKey">
): BankTransfer {
  return {
    shopId: "shop1",
    note: "",
    createdBy: "u1",
    createdByName: "เจ้าของร้าน",
    createdAt: 0,
    ...overrides,
  };
}

function makeExpense(overrides: Partial<Expense> & Pick<Expense, "id" | "dateKey" | "amount">): Expense {
  return {
    shopId: "shop1",
    category: "กลุ่มสั่งหมู",
    description: "หมู",
    paymentMethod: "cash",
    createdBy: "u1",
    createdByName: "เจ้าของร้าน",
    createdAt: 0,
    ...overrides,
  };
}

// --- businessDayBounds -------------------------------------------------------------------------

test("businessDayBounds: a 16:00-cutoff business day labeled '19' spans 16:00 the 18th to 16:00 the 19th", () => {
  const { startMs, endMs } = businessDayBounds("2026-09-19", 16);
  // 16:00 Bangkok on the 18th = 09:00 UTC on the 18th.
  assert.equal(startMs, Date.UTC(2026, 8, 18, 9, 0, 0, 0));
  // Ends one ms before 16:00 Bangkok on the 19th.
  assert.equal(endMs, Date.UTC(2026, 8, 19, 9, 0, 0, 0) - 1);
});

// --- businessDaySales ----------------------------------------------------------------------------

test("businessDaySales: splits cash vs QR vs other, grouped by business day not midnight", () => {
  const orders = [
    // 20:00 Bangkok on the 18th -> business day "19" (16:00 cutoff)
    makeOrder({ id: "o1", total: 100, paidAt: Date.UTC(2026, 8, 18, 13, 0), paymentMethodId: "cash1" }),
    // 01:00 Bangkok on the 19th (already past midnight) -> still business day "19"
    makeOrder({ id: "o2", total: 200, paidAt: Date.UTC(2026, 8, 18, 18, 0), paymentMethodId: "qr1" }),
    // Delivery order, same business day
    makeOrder({ id: "o3", total: 50, paidAt: Date.UTC(2026, 8, 18, 19, 0), paymentMethodId: "delivery1" }),
  ];
  const days = businessDaySales(orders, METHODS, "2026-09-18", "2026-09-19", 16);
  const day19 = days.find((d) => d.dateKey === "2026-09-19")!;
  assert.equal(day19.cash, 100);
  assert.equal(day19.qr, 200);
  assert.equal(day19.other, 50);
  assert.equal(day19.total, 350);
  assert.equal(day19.orderCount, 3);
});

// --- transfersForBusinessDay / expensesForDay -----------------------------------------------------

test("transfersForBusinessDay: matches by the logged businessDayKey, not the transfer's own timestamp", () => {
  const transfers = [
    // 23:00 on the 18th — settles the 16:00-23:00 portion of business day "19"
    makeTransfer({ id: "t1", transferredAt: Date.UTC(2026, 8, 18, 16, 0), amount: 810, businessDayKey: "2026-09-19" }),
    // 23:00 on the 19th (a whole calendar day later) — but still logged against business day
    // "19", since that's the shift it actually pays out, not "20" which a naive time-window
    // check would wrongly attribute it to.
    makeTransfer({ id: "t2", transferredAt: Date.UTC(2026, 8, 19, 16, 0), amount: 980, businessDayKey: "2026-09-19" }),
    // Belongs to a different business day entirely — must not leak in
    makeTransfer({ id: "t3", transferredAt: Date.UTC(2026, 8, 20, 16, 0), amount: 500, businessDayKey: "2026-09-20" }),
  ];
  assert.equal(transfersForBusinessDay(transfers, "2026-09-19"), 1790);
});

test("expensesForDay: matches by plain dateKey", () => {
  const expenses = [
    makeExpense({ id: "e1", dateKey: "2026-09-19", amount: 300 }),
    makeExpense({ id: "e2", dateKey: "2026-09-19", amount: 200 }),
    makeExpense({ id: "e3", dateKey: "2026-09-20", amount: 999 }),
  ];
  assert.equal(expensesForDay(expenses, "2026-09-19"), 500);
});

// --- reconciliationRows --------------------------------------------------------------------------

test("reconciliationRows: the exact '980 baht missing' scenario reads as pending, not lost", () => {
  const orders = [
    makeOrder({ id: "o1", total: 810, paidAt: Date.UTC(2026, 8, 18, 13, 0), paymentMethodId: "qr1" }), // 20:00 the 18th
    makeOrder({ id: "o2", total: 980, paidAt: Date.UTC(2026, 8, 18, 19, 0), paymentMethodId: "qr1" }), // 02:00 the 19th
  ];
  // Only the first batch (810) has actually transferred so far — the 980 hasn't hit 23:00 yet.
  const transfers = [makeTransfer({ id: "t1", transferredAt: Date.UTC(2026, 8, 18, 16, 0), amount: 810, businessDayKey: "2026-09-19" })];
  const rows = reconciliationRows(orders, METHODS, transfers, [], "2026-09-18", "2026-09-19", 16);
  const row = rows.find((r) => r.dateKey === "2026-09-19")!;
  assert.equal(row.qrSales, 1790);
  assert.equal(row.transferred, 810);
  assert.equal(row.pendingTransfer, 980);
  assert.equal(row.settled, false);
});

test("reconciliationRows: settled once the second transfer batch lands, expenses reduce net", () => {
  const orders = [
    makeOrder({ id: "o1", total: 810, paidAt: Date.UTC(2026, 8, 18, 13, 0), paymentMethodId: "qr1" }),
    makeOrder({ id: "o2", total: 980, paidAt: Date.UTC(2026, 8, 18, 19, 0), paymentMethodId: "qr1" }),
  ];
  const transfers = [
    makeTransfer({ id: "t1", transferredAt: Date.UTC(2026, 8, 18, 16, 0), amount: 810, businessDayKey: "2026-09-19" }),
    makeTransfer({ id: "t2", transferredAt: Date.UTC(2026, 8, 19, 16, 0), amount: 980, businessDayKey: "2026-09-19" }),
  ];
  const expenses = [makeExpense({ id: "e1", dateKey: "2026-09-19", amount: 300 })];
  const rows = reconciliationRows(orders, METHODS, transfers, expenses, "2026-09-18", "2026-09-19", 16);
  const row = rows.find((r) => r.dateKey === "2026-09-19")!;
  assert.equal(row.transferred, 1790);
  assert.equal(row.pendingTransfer, 0);
  assert.equal(row.settled, true);
  assert.equal(row.expenses, 300);
  assert.equal(row.net, 1790 - 300);
});

test("reconciliationRows: a transfer larger than that day's QR sales never produces a negative pending", () => {
  const orders = [makeOrder({ id: "o1", total: 100, paidAt: Date.UTC(2026, 8, 18, 13, 0), paymentMethodId: "qr1" })];
  const transfers = [makeTransfer({ id: "t1", transferredAt: Date.UTC(2026, 8, 18, 16, 0), amount: 500, businessDayKey: "2026-09-19" })];
  const rows = reconciliationRows(orders, METHODS, transfers, [], "2026-09-18", "2026-09-19", 16);
  const row = rows.find((r) => r.dateKey === "2026-09-19")!;
  assert.equal(row.pendingTransfer, 0);
  assert.equal(row.settled, true);
});
