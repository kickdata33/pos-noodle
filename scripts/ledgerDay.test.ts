/**
 * Tests for the single-table ledger merge in `src/lib/pos/ledgerDay.ts` (run: npm run test:pos).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { ledgerDayRows, ledgerRangeTotals } from "../src/lib/pos/ledgerDay";
import type { ReconciliationRow } from "../src/lib/pos/reconciliation";
import type { DailyFloat, DeliveryPayout, Expense } from "../src/types";

function row(overrides: Partial<ReconciliationRow> & { dateKey: string }): ReconciliationRow {
  return {
    cashSales: 0,
    qrSales: 0,
    otherSales: 0,
    totalSales: 0,
    transferred: 0,
    pendingTransfer: 0,
    overTransferred: 0,
    expenses: 0,
    net: 0,
    netReceived: 0,
    settled: true,
    ...overrides,
  };
}

function float(overrides: Partial<DailyFloat> & { businessDayKey: string }): DailyFloat {
  return {
    id: `shop1_${overrides.businessDayKey}`,
    shopId: "shop1",
    startingCash: null,
    cashMovedOut: null,
    cashTransferAdjustment: null,
    closingCashCounted: null,
    closingCashCountedAt: null,
    updatedBy: "u1",
    updatedByName: "Test",
    updatedAt: 0,
    ...overrides,
  };
}

function expense(overrides: Partial<Expense> & { dateKey: string; amount: number }): Expense {
  return {
    id: `e_${Math.random()}`,
    shopId: "shop1",
    category: "อื่นๆ" as Expense["category"],
    description: "",
    paymentMethod: "cash",
    recurringExpenseId: null,
    createdBy: "u1",
    createdByName: "Test",
    createdAt: 0,
    ...overrides,
  };
}

function payout(overrides: Partial<DeliveryPayout> & { dateKey: string; amount: number }): DeliveryPayout {
  return {
    id: `p_${Math.random()}`,
    shopId: "shop1",
    platform: "grab",
    note: "",
    createdBy: "u1",
    createdByName: "Test",
    createdAt: 0,
    ...overrides,
  };
}

test("ledgerDayRows: delivery revenue folds into both salesTotal and receivedTotal", () => {
  const rows = ledgerDayRows(
    [row({ dateKey: "2026-10-24", totalSales: 4965, netReceived: 4965 })],
    [],
    [],
    [payout({ dateKey: "2026-10-24", amount: 420 })]
  );
  assert.equal(rows[0].deliveryRevenue, 420);
  assert.equal(rows[0].salesTotal, 5385);
  assert.equal(rows[0].receivedTotal, 5385);
});

test("ledgerDayRows: a day with no DailyFloat doc yet reads as not-counted (null), not zero", () => {
  const rows = ledgerDayRows([row({ dateKey: "2026-10-24", cashSales: 1550 })], [], [], []);
  assert.equal(rows[0].startingCash, null);
  assert.equal(rows[0].cashDifference, null);
  assert.equal(rows[0].combined, null);
});

test("ledgerDayRows: the day-28 scenario end to end — post-move-out count entered directly, nets correctly", () => {
  const rows = ledgerDayRows(
    [row({ dateKey: "2026-10-28", cashSales: 1815, qrSales: 2700, totalSales: 4515, netReceived: 4515, transferred: 2700, pendingTransfer: 0, overTransferred: 0, expenses: 7048 })],
    [float({ businessDayKey: "2026-10-28", startingCash: 2420, cashMovedOut: 2500, closingCashCounted: 1720 })],
    [expense({ dateKey: "2026-10-28", amount: 570, paymentMethod: "cash" }), expense({ dateKey: "2026-10-28", amount: 6478, paymentMethod: "transfer" })],
    []
  );
  const r = rows[0];
  assert.equal(r.expectedCashBeforeMoveOut, 2420 + 1815 - 570); // 3665 — only the cash-paid expense counts here
  assert.equal(r.cashRemainingNow, 3665 - 2500); // 1165 — what should physically be left in the drawer right now
  assert.equal(r.cashDifference, 555); // (1720 + 2500) - 3665
  assert.equal(r.combined, 555); // no transfer gap that day, so combined == cashDifference
  // This is the exact real-world case that motivated the v2 redesign: a loss day (rent + payroll
  // landed that day) that simultaneously counts a cash excess — netProfit and combined move in
  // opposite directions and must never be read as the same number.
  assert.equal(r.netProfit, 4515 - 7048); // -2533 — ขาดทุน, totally independent of the +555 cash excess above
});

test("ledgerDayRows: netProfit is never null, even on a day with no DailyFloat doc at all", () => {
  const rows = ledgerDayRows([row({ dateKey: "2026-10-24", totalSales: 4965, netReceived: 4965, expenses: 1200 })], [], [], []);
  assert.equal(rows[0].netProfit, 4965 - 1200);
  assert.equal(rows[0].cashRemainingNow, null); // still null — no starting cash entered yet to compute it from
});

test("ledgerDayRows: only cash-paid expenses reduce the cash-float check — transfer-paid ones don't", () => {
  const rows = ledgerDayRows(
    [row({ dateKey: "2026-10-01", cashSales: 1000 })],
    [float({ businessDayKey: "2026-10-01", startingCash: 500, cashMovedOut: 0, closingCashCounted: 1500 })],
    [expense({ dateKey: "2026-10-01", amount: 9999, paymentMethod: "transfer" })], // must NOT affect cashDifference
    []
  );
  const r = rows[0];
  assert.equal(r.expectedCashBeforeMoveOut, 1500); // 500 + 1000 - 0 (transfer expense ignored)
  assert.equal(r.cashDifference, 0); // 1500 counted == 1500 expected
});

test("ledgerRangeTotals: sums every field and nets combined only over days actually counted", () => {
  const rows = ledgerDayRows(
    [
      row({ dateKey: "2026-10-28", cashSales: 1815, totalSales: 4515, netReceived: 4515, overTransferred: 0, pendingTransfer: 0, expenses: 570 }),
      row({ dateKey: "2026-10-29", cashSales: 1770, totalSales: 5385, netReceived: 5385, overTransferred: 0, pendingTransfer: 50, expenses: 146 }),
      row({ dateKey: "2026-10-30", totalSales: 0, netReceived: -1005 }), // today, nothing counted yet
    ],
    [
      float({ businessDayKey: "2026-10-28", startingCash: 2420, cashMovedOut: 2500, closingCashCounted: 1720 }),
      float({ businessDayKey: "2026-10-29", startingCash: 1720, cashMovedOut: 0, closingCashCounted: 1800 }),
      // 30 ต.ค. has no float doc at all — "today", not yet closed
    ],
    [
      expense({ dateKey: "2026-10-28", amount: 570, paymentMethod: "cash" }),
      expense({ dateKey: "2026-10-29", amount: 146, paymentMethod: "cash" }),
    ],
    [payout({ dateKey: "2026-10-29", amount: 650 })]
  );
  const totals = ledgerRangeTotals(rows);
  assert.equal(totals.totalDays, 3);
  assert.equal(totals.combinedKnownDays, 2); // 30 ต.ค. has no count yet, so it's excluded, not treated as 0
  assert.equal(totals.deliveryRevenue, 650);
  assert.equal(totals.salesTotal, 4515 + (5385 + 650) + 0);
  // 28: expected 2420+1815-570=3665, counted 1720+2500=4220, cashDifference 555, no transfer gap -> combined 555
  // 29: expected 1720+1770-146=3344, counted 1800+0=1800, cashDifference -1544, pendingTransfer 50 -> combined -1594
  // 30 (today): no float doc -> combined null -> excluded from the sum entirely
  assert.equal(totals.combined, 555 + -1594);
  // netProfit, unlike combined, is never excluded — every day (including today, not-yet-closed) counts:
  // 28: 4515 - 570 = 3945, 29: (5385+650) - 146 = 5889, 30: 0 - 0 = 0
  assert.equal(totals.netProfit, 3945 + 5889 + 0);
});
