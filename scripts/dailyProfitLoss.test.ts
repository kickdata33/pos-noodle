/**
 * Tests for the pure daily "กำไร/ขาดทุนสุทธิ รวม Delivery" math in
 * `src/lib/pos/dailyProfitLoss.ts` (run: npm run test:pos).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { dailyProfitLossRows, totalProfitLoss } from "../src/lib/pos/dailyProfitLoss";
import type { DeliveryPayout, Expense, Order } from "../src/types";

function order(id: string, total: number, paidAt: number): Order {
  return {
    id,
    shopId: "shop1",
    orderNumber: 1,
    status: "paid",
    channelId: "c1",
    channelName: "หน้าร้าน",
    items: [],
    subtotal: total,
    discount: 0,
    vat: 0,
    serviceCharge: 0,
    total,
    paymentMethodId: "pm1",
    paymentMethodName: "เงินสด",
    paymentMethodCode: "cash",
    tableId: null,
    tableName: null,
    note: "",
    createdAt: paidAt,
    paidAt,
    createdBy: "u1",
    createdByName: "Admin",
  } as unknown as Order;
}

function payout(dateKey: string, amount: number, createdAt = 0): DeliveryPayout {
  return { id: `${dateKey}-p`, shopId: "shop1", dateKey, platform: "grab", amount, note: "", createdBy: "u1", createdByName: "Admin", createdAt };
}

function expense(dateKey: string, amount: number, createdAt = 0): Expense {
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
    createdAt,
  };
}

// 2026-09-15 00:00:00 Bangkok time in epoch ms, used as a known anchor for `paidAt` below.
const SEP_15_MIDNIGHT_BKK = Date.UTC(2026, 8, 15, 0, 0, 0) - 7 * 60 * 60 * 1000;

test("dailyProfitLossRows: combines POS sales, delivery revenue and expenses by plain calendar day", () => {
  const rows = dailyProfitLossRows(
    [order("o1", 1000, SEP_15_MIDNIGHT_BKK + 10 * 60 * 60 * 1000)], // 10:00 on the 15th
    [payout("2026-09-15", 300)],
    [expense("2026-09-15", 400)],
    "2026-09-15",
    "2026-09-15"
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].posSales, 1000);
  assert.equal(rows[0].deliveryRevenue, 300);
  assert.equal(rows[0].expenses, 400);
  assert.equal(rows[0].net, 900);
});

test("dailyProfitLossRows: a day with no orders/delivery/expenses still appears, all zero", () => {
  const rows = dailyProfitLossRows([], [], [], "2026-09-15", "2026-09-16");
  assert.deepEqual(
    rows.map((r) => r.dateKey),
    ["2026-09-15", "2026-09-16"]
  );
  assert.equal(rows[0].net, 0);
  assert.equal(rows[1].net, 0);
});

test("dailyProfitLossRows: a net loss day reads as a clear negative number, not floored", () => {
  const rows = dailyProfitLossRows([order("o1", 200, SEP_15_MIDNIGHT_BKK)], [], [expense("2026-09-15", 1000)], "2026-09-15", "2026-09-15");
  assert.equal(rows[0].net, -800);
});

test("dailyProfitLossRows: an order outside [startKey, endKey] is excluded", () => {
  const rows = dailyProfitLossRows(
    [order("o1", 1000, SEP_15_MIDNIGHT_BKK), order("o2", 500, SEP_15_MIDNIGHT_BKK + 24 * 60 * 60 * 1000)],
    [],
    [],
    "2026-09-15",
    "2026-09-15"
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].posSales, 1000);
});

test("dailyProfitLossRows: uses plain bangkokDateKey, never a business-day cutoff (an order just after midnight is the next calendar day)", () => {
  // 00:30 on the 16th (Bangkok time) — a shift-based grouping with a 16:00 cutoff would label
  // this "the 15th"; the plain calendar grouping here must label it "the 16th".
  const justAfterMidnight = SEP_15_MIDNIGHT_BKK + 24 * 60 * 60 * 1000 + 30 * 60 * 1000;
  const rows = dailyProfitLossRows([order("o1", 1000, justAfterMidnight)], [], [], "2026-09-16", "2026-09-16");
  assert.equal(rows[0].posSales, 1000);
});

test("totalProfitLoss: sums every row's fields across the range", () => {
  const rows = dailyProfitLossRows(
    [order("o1", 1000, SEP_15_MIDNIGHT_BKK), order("o2", 500, SEP_15_MIDNIGHT_BKK + 24 * 60 * 60 * 1000)],
    [payout("2026-09-15", 100), payout("2026-09-16", 50)],
    [expense("2026-09-15", 200)],
    "2026-09-15",
    "2026-09-16"
  );
  const total = totalProfitLoss(rows);
  assert.equal(total.posSales, 1500);
  assert.equal(total.deliveryRevenue, 150);
  assert.equal(total.expenses, 200);
  assert.equal(total.net, 1450);
});

test("totalProfitLoss: zero for an empty row list", () => {
  assert.deepEqual(totalProfitLoss([]), { posSales: 0, deliveryRevenue: 0, expenses: 0, net: 0 });
});

test("dailyProfitLossRows: with businessDayFromHour, orders group by shift instead of plain calendar", () => {
  // 00:30 on the 16th (Bangkok) belongs to the shift that started 16:00 on the 15th.
  const justAfterMidnight = SEP_15_MIDNIGHT_BKK + 24 * 60 * 60 * 1000 + 30 * 60 * 1000;
  const rows = dailyProfitLossRows([order("o1", 1000, justAfterMidnight)], [], [], "2026-09-15", "2026-09-15", 16);
  assert.equal(rows[0].posSales, 1000);
});

test("dailyProfitLossRows: with businessDayFromHour, a live same-moment entry still gets its cutoff disambiguated", () => {
  // Logged with dateKey "2026-09-16" (defaulted to "today" at the moment of entry) but actually
  // entered at 00:30 on the 16th — still part of the shift that started 16:00 on the 15th, and
  // createdAt's own plain calendar date ("2026-09-16") matches the stored dateKey, so this counts
  // as a live entry and gets re-derived via the cutoff.
  const justAfterMidnight = SEP_15_MIDNIGHT_BKK + 24 * 60 * 60 * 1000 + 30 * 60 * 1000;
  const rows = dailyProfitLossRows(
    [],
    [payout("2026-09-16", 300, justAfterMidnight)],
    [expense("2026-09-16", 200, justAfterMidnight)],
    "2026-09-15",
    "2026-09-15",
    16
  );
  assert.equal(rows[0].deliveryRevenue, 300);
  assert.equal(rows[0].expenses, 200);
});

test("dailyProfitLossRows: with businessDayFromHour, a backfilled/recurring-generated row keeps its stored dateKey, not createdAt's day", () => {
  // Regression test for a real production bug: a recurring-expense row for "2026-09-15" that was
  // actually auto-generated two days later (createdAt on the 17th, catching up a missed day) must
  // still count under the 15th — not get dumped onto whatever day the catch-up happened to run.
  const generatedTwoDaysLater = SEP_15_MIDNIGHT_BKK + 2 * 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000;
  const rows = dailyProfitLossRows(
    [],
    [payout("2026-09-15", 300, generatedTwoDaysLater)],
    [expense("2026-09-15", 200, generatedTwoDaysLater)],
    "2026-09-15",
    "2026-09-15",
    16
  );
  assert.equal(rows[0].deliveryRevenue, 300);
  assert.equal(rows[0].expenses, 200);
});

test("dailyProfitLossRows: with businessDayFromHour, a live daytime expense before the next shift starts keeps its own calendar date", () => {
  // Regression test for a second real production bug: an expense entered at 10:00 — e.g. the
  // morning market run for that evening's service — is well before `businessDayFromHour` (16) but
  // must NOT be dumped onto the previous day the way a just-after-midnight entry is. The shop is
  // simply closed between its close hour (`businessDayToHour`, defaults to 6) and the next shift's
  // start, so there's no still-open previous shift this could be confused with.
  const tenAm = SEP_15_MIDNIGHT_BKK + 10 * 60 * 60 * 1000;
  const rows = dailyProfitLossRows(
    [],
    [payout("2026-09-15", 300, tenAm)],
    [expense("2026-09-15", 200, tenAm)],
    "2026-09-15",
    "2026-09-15",
    16
  );
  assert.equal(rows[0].deliveryRevenue, 300);
  assert.equal(rows[0].expenses, 200);
});

test("dailyProfitLossRows: businessDayFromHour left undefined keeps plain-dateKey behavior exactly as before", () => {
  const rows = dailyProfitLossRows([], [payout("2026-09-15", 300, 0)], [expense("2026-09-15", 200, 0)], "2026-09-15", "2026-09-15");
  assert.equal(rows[0].deliveryRevenue, 300);
  assert.equal(rows[0].expenses, 200);
});
