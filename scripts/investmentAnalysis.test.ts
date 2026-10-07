/**
 * Tests for the pure "สรุปการลงทุน" math in `src/lib/pos/investmentAnalysis.ts`
 * (run: npm run test:pos).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  computePaybackProgress,
  computeTargetPaybackPlan,
  summarizeHistoricalPerformance,
  summarizeInvestments,
} from "../src/lib/pos/investmentAnalysis";
import type { DeliveryPayout, Expense, InvestmentItem, Order } from "../src/types";

function order(id: string, total: number, paidAt: number): Order {
  return {
    id,
    shopId: "shop1",
    orderNumber: "1",
    orderType: "dineIn",
    channelId: "c1",
    channelName: "หน้าร้าน",
    tableId: null,
    tableName: null,
    status: "PAID",
    items: [],
    subtotal: total,
    discount: 0,
    serviceCharge: 0,
    tax: 0,
    total,
    paymentStatus: "PAID",
    paymentMethodId: "pm1",
    paymentMethodName: "เงินสด",
    cashReceived: null,
    changeDue: null,
    createdBy: "u1",
    createdByName: "Admin",
    createdAt: paidAt,
    updatedAt: paidAt,
    paidAt,
  } as unknown as Order;
}

function payout(dateKey: string, amount: number): DeliveryPayout {
  return {
    id: `${dateKey}-p`,
    shopId: "shop1",
    dateKey,
    platform: "grab",
    amount,
    note: "",
    createdBy: "u1",
    createdByName: "Admin",
    createdAt: 0,
  };
}

function expense(dateKey: string, amount: number): Expense {
  return {
    id: `${dateKey}-e`,
    shopId: "shop1",
    dateKey,
    category: "อื่นๆ",
    description: "test",
    amount,
    paymentMethod: "cash",
    recurringExpenseId: null,
    createdBy: "u1",
    createdByName: "Admin",
    createdAt: 0,
  };
}

function investment(dateKey: string, amount: number, description = "test"): InvestmentItem {
  return {
    id: `${dateKey}-i`,
    shopId: "shop1",
    dateKey,
    description,
    amount,
    createdBy: "u1",
    createdByName: "Admin",
    createdAt: 0,
  };
}

// 2026-09-15 00:00:00 Bangkok time in epoch ms, used as a known anchor for `paidAt` below.
const SEP_15_MIDNIGHT_BKK = Date.UTC(2026, 8, 15, 0, 0, 0) - 7 * 60 * 60 * 1000;

test("summarizeInvestments: sums amounts and tracks the earliest/latest dateKey", () => {
  const result = summarizeInvestments([
    investment("2026-01-10", 50000, "ค่าเซ้ง"),
    investment("2026-02-01", 15000, "ตู้แช่"),
    investment("2026-01-20", 5000, "โต๊ะเก้าอี้"),
  ]);
  assert.equal(result.totalInvested, 70000);
  assert.equal(result.itemCount, 3);
  assert.equal(result.earliestDateKey, "2026-01-10");
  assert.equal(result.latestDateKey, "2026-02-01");
});

test("summarizeInvestments: all zero/null for an empty list", () => {
  assert.deepEqual(summarizeInvestments([]), {
    totalInvested: 0,
    itemCount: 0,
    earliestDateKey: null,
    latestDateKey: null,
  });
});

test("summarizeHistoricalPerformance: averages revenue/expenses over the days actually spanned", () => {
  // 3 days of history: the 15th, 16th, 17th. Total net = (1000+300-400) + (0+0-0) + (500+0-100) = 900 + 0 + 400 = 1300.
  const perf = summarizeHistoricalPerformance(
    [order("o1", 1000, SEP_15_MIDNIGHT_BKK), order("o2", 500, SEP_15_MIDNIGHT_BKK + 2 * 24 * 60 * 60 * 1000)],
    [payout("2026-09-15", 300)],
    [expense("2026-09-15", 400), expense("2026-09-17", 100)],
    "2026-09-17"
  );
  assert.equal(perf.startDateKey, "2026-09-15");
  assert.equal(perf.daysOfHistory, 3);
  assert.equal(perf.totalRevenue, 1800);
  assert.equal(perf.totalExpenses, 500);
  assert.equal(perf.totalNet, 1300);
  assert.ok(Math.abs(perf.avgRevenuePerDay - 600) < 0.001);
  assert.ok(Math.abs(perf.avgNetPerDay - 1300 / 3) < 0.001);
  assert.ok(Math.abs(perf.avgNetPerMonth - (1300 / 3) * 30) < 0.001);
});

test("summarizeHistoricalPerformance: no data at all yet — everything zero, no divide-by-zero", () => {
  const perf = summarizeHistoricalPerformance([], [], [], "2026-09-17");
  assert.equal(perf.startDateKey, null);
  assert.equal(perf.daysOfHistory, 0);
  assert.equal(perf.avgRevenuePerDay, 0);
  assert.equal(perf.avgNetPerDay, 0);
});

test("summarizeHistoricalPerformance: a loss period reads as a clear negative net, not floored", () => {
  const perf = summarizeHistoricalPerformance([order("o1", 100, SEP_15_MIDNIGHT_BKK)], [], [expense("2026-09-15", 900)], "2026-09-15");
  assert.equal(perf.totalNet, -800);
  assert.equal(perf.avgNetPerDay, -800);
});

test("computePaybackProgress: still recovering — projects a payback date from the average pace", () => {
  const perf = summarizeHistoricalPerformance(
    [order("o1", 1000, SEP_15_MIDNIGHT_BKK)],
    [],
    [expense("2026-09-15", 200)],
    "2026-09-15"
  );
  // avgNetPerDay = 800, totalInvested = 8000 -> 10 days remaining from "2026-09-15".
  const progress = computePaybackProgress(8000, perf, "2026-09-15");
  assert.equal(progress.cumulativeNet, 800);
  assert.equal(progress.amountRemaining, 7200);
  assert.equal(progress.isFullyRecovered, false);
  assert.ok(progress.percentRecovered !== null && Math.abs(progress.percentRecovered - 10) < 0.001);
  assert.equal(progress.estimatedDaysRemaining, 9);
  assert.equal(progress.estimatedPaybackDateKey, "2026-09-24");
});

test("computePaybackProgress: already fully recovered — no remaining days or date, remaining reads negative", () => {
  const perf = summarizeHistoricalPerformance([order("o1", 1000, SEP_15_MIDNIGHT_BKK)], [], [], "2026-09-15");
  const progress = computePaybackProgress(500, perf, "2026-09-15");
  assert.equal(progress.isFullyRecovered, true);
  assert.equal(progress.amountRemaining, -500);
  assert.equal(progress.estimatedDaysRemaining, null);
  assert.equal(progress.estimatedPaybackDateKey, null);
});

test("computePaybackProgress: losing money on average — never recovers, so no projected date", () => {
  const perf = summarizeHistoricalPerformance([], [], [expense("2026-09-15", 500)], "2026-09-15");
  const progress = computePaybackProgress(10000, perf, "2026-09-15");
  assert.equal(progress.isFullyRecovered, false);
  assert.equal(progress.estimatedDaysRemaining, null);
  assert.equal(progress.estimatedPaybackDateKey, null);
});

test("computePaybackProgress: zero invested — percentRecovered is null (nothing to recover)", () => {
  const perf = summarizeHistoricalPerformance([order("o1", 1000, SEP_15_MIDNIGHT_BKK)], [], [], "2026-09-15");
  const progress = computePaybackProgress(0, perf, "2026-09-15");
  assert.equal(progress.percentRecovered, null);
  assert.equal(progress.isFullyRecovered, true);
});

test("computeTargetPaybackPlan: required revenue covers both the payback target and historical average operating cost", () => {
  const perf = summarizeHistoricalPerformance(
    [order("o1", 1000, SEP_15_MIDNIGHT_BKK)],
    [],
    [expense("2026-09-15", 300)],
    "2026-09-15"
  );
  // avgExpensePerDay = 300. totalInvested 30000 over 100 days -> requiredNetPerDay = 300.
  const plan = computeTargetPaybackPlan(30000, 100, perf);
  assert.equal(plan.targetDays, 100);
  assert.equal(plan.requiredNetPerDay, 300);
  assert.equal(plan.requiredRevenuePerDay, 600);
  assert.equal(plan.requiredRevenuePerMonth, 18000);
  assert.equal(plan.actualAvgRevenuePerDay, 1000);
  assert.equal(plan.gapRevenuePerDay, -400);
});

test("computeTargetPaybackPlan: a 0 or negative target period is clamped to at least 1 day", () => {
  const perf = summarizeHistoricalPerformance([], [], [], "2026-09-15");
  const plan = computeTargetPaybackPlan(1000, 0, perf);
  assert.equal(plan.targetDays, 1);
  assert.equal(plan.requiredNetPerDay, 1000);
});
