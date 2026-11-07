/**
 * Tests for Print Station ticket content (run: npm run test:pos) — kitchen deltas, cancellation
 * lines, and the check bill's PromptPay QR. Pure functions only; no Firestore.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildKitchenTicketLines,
  checkBillJobFields,
  computeKitchenSend,
  countUnsentToKitchen,
  kitchenDestinationLabel,
} from "../src/lib/pos/printTickets";
import type { Order, OrderItem, ShopSettings } from "../src/types";

function item(overrides: Partial<OrderItem> & Pick<OrderItem, "id">): OrderItem {
  return {
    productId: "p",
    productName: "ก๋วยเตี๋ยวหมู",
    quantity: 1,
    unitPrice: 50,
    modifiers: [],
    note: "",
    lineTotal: 50,
    ...overrides,
  };
}

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: "o1",
    orderNumber: "A-0001",
    shopId: "shop1",
    orderType: "dineIn",
    channelId: "c",
    channelName: "หน้าร้าน",
    tableId: "t",
    tableName: "3",
    status: "OPEN",
    items: [],
    subtotal: 120,
    discount: 0,
    serviceCharge: 0,
    tax: 0,
    total: 120,
    paymentStatus: "UNPAID",
    paymentMethodId: null,
    paymentMethodName: null,
    cashReceived: null,
    changeDue: null,
    createdBy: "u",
    createdByName: "u",
    createdAt: 1,
    updatedAt: 1,
    paidAt: null,
    ...overrides,
  };
}

function settings(overrides: Partial<ShopSettings> = {}): ShopSettings {
  return {
    id: "shop1",
    shopId: "shop1",
    name: "ร้านทดสอบ",
    logoUrl: null,
    phone: "",
    address: "",
    taxId: "",
    receiptFooterText: "",
    currency: "THB",
    theme: "light",
    vatEnabled: false,
    vatRate: 0,
    serviceChargeEnabled: false,
    serviceChargeRate: 0,
    promptPayId: null,
    paymentQrImageUrl: null,
    pickupIdentificationMode: "queue",
    updatedAt: 1,
    ...overrides,
  };
}

test("first send includes every line, and marks them all sent", () => {
  const items = [item({ id: "a", quantity: 2 }), item({ id: "b", productName: "ชาเย็น" })];
  const send = computeKitchenSend(items)!;
  assert.deepEqual(
    send.added.map((l) => [l.item.id, l.quantity]),
    [["a", 2], ["b", 1]]
  );
  assert.equal(send.cancelled.length, 0);
  assert.deepEqual(send.updatedItems.map((i) => i.kitchenSentQty), [2, 1]);
});

test("second round sends only what's new — including a raised quantity on an old line", () => {
  const items = [item({ id: "a", quantity: 3, kitchenSentQty: 2 }), item({ id: "b", kitchenSentQty: 1 }), item({ id: "c" })];
  const send = computeKitchenSend(items)!;
  assert.deepEqual(
    send.added.map((l) => [l.item.id, l.quantity]),
    [["a", 1], ["c", 1]]
  );
  assert.equal(countUnsentToKitchen(items), 2);
});

test("nothing new → null, so callers write nothing", () => {
  assert.equal(computeKitchenSend([item({ id: "a", quantity: 2, kitchenSentQty: 2 })]), null);
  assert.equal(computeKitchenSend([]), null);
});

test("lowered quantity after sending becomes a cancellation", () => {
  const send = computeKitchenSend([item({ id: "a", quantity: 1, kitchenSentQty: 3 })])!;
  assert.equal(send.added.length, 0);
  assert.deepEqual(send.cancelled.map((l) => l.quantity), [2]);
  assert.equal(send.updatedItems[0].kitchenSentQty, 1);
});

test("kitchen ticket: big destination, round number, modifiers and note, no prices", () => {
  const lines = buildKitchenTicketLines(
    order(),
    {
      added: [
        {
          item: item({
            id: "a",
            modifiers: [{ groupId: "g", groupName: "เส้น", optionId: "o", optionName: "เส้นเล็ก", priceDelta: 0 }],
            note: "ไม่ผัก",
          }),
          quantity: 2,
        },
      ],
      cancelled: [],
    },
    2
  );
  const text = lines.map((l) => l.text);
  assert.ok(text.includes("ใบสั่งครัว รอบที่ 2"));
  assert.ok(lines.some((l) => l.text === "โต๊ะ 3" && l.size === 2));
  assert.ok(text.includes("2 x ก๋วยเตี๋ยวหมู"));
  assert.ok(text.some((t) => t.includes("เส้นเล็ก")));
  assert.ok(text.some((t) => t.includes("ไม่ผัก")));
  assert.ok(!text.some((t) => t.includes("฿") || t.includes("50")));
});

test("cancel-only ticket is headed as a cancellation", () => {
  const lines = buildKitchenTicketLines(order(), { added: [], cancelled: [{ item: item({ id: "a" }), quantity: 1 }] }, 1);
  assert.equal(lines[0].text, "*** ยกเลิกรายการ ***");
  assert.ok(lines.some((l) => l.text === "-1 x ก๋วยเตี๋ยวหมู"));
});

test("destination label falls back to channel + customer label off-table", () => {
  assert.equal(kitchenDestinationLabel({ orderNumber: "x", tableName: null, channelName: "กลับบ้าน", customerLabel: "คิว 12" }), "กลับบ้าน คิว 12");
  assert.equal(kitchenDestinationLabel({ orderNumber: "x", tableName: null, channelName: "Grab" }), "Grab");
});

test("check bill carries a PromptPay QR for the exact total when a PromptPay ID is set", () => {
  const job = checkBillJobFields(order({ items: [item({ id: "a" })] }), settings({ promptPayId: "0812345678" }));
  assert.equal(job.station, "cashier");
  assert.ok(job.qrPayload && job.qrPayload.includes("5406120.00"), "amount tag 54, length 06, value 120.00");
  assert.ok(job.qrCaption?.includes("120"));
  assert.ok(job.lines.some((l) => l.text.includes("ใบแจ้งค่าอาหาร")));
});

test("check bill without PromptPay ID prints with no QR", () => {
  const job = checkBillJobFields(order(), settings());
  assert.equal(job.qrPayload, null);
  assert.equal(job.qrCaption, null);
});

test("table QR slip: big table name, the ordering link as the QR, session warning", async () => {
  const { tableQrJobFields } = await import("../src/lib/pos/printTickets");
  const job = tableQrJobFields({
    shopName: "ร้านทดสอบ",
    tableName: "5",
    url: "https://shop.ranpos.online/order/table/t5?s=abc",
    sessionMode: true,
  });
  assert.equal(job.station, "cashier");
  assert.equal(job.kind, "tableQr");
  assert.equal(job.qrPayload, "https://shop.ranpos.online/order/table/t5?s=abc");
  assert.ok(job.lines.some((l) => l.text === "โต๊ะ 5" && l.size === 2));
  assert.ok(job.qrCaption?.includes("เช็คบิล"));
  const staticJob = tableQrJobFields({ shopName: "ร้าน", tableName: "1", url: "u", sessionMode: false });
  assert.ok(!staticJob.qrCaption?.includes("เช็คบิล"));
});
