/**
 * Tests for the printer-agnostic receipt content builder (run: npm run test:pos). Pure content
 * only — no XML/printer-protocol concerns here, see `eposPrint.test.ts` for that layer.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { buildOrderReceipt } from "../src/lib/pos/receipt";
import type { Order, OrderItem, ShopSettings } from "../src/types";

function settings(overrides: Partial<ShopSettings> = {}): ShopSettings {
  return {
    id: "s1",
    shopId: "shop1",
    name: "ร้านก๋วยเตี๋ยว",
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
    pickupIdentificationMode: "queue",
    receiptPrinterIp: null,
    updatedAt: 1,
    ...overrides,
  };
}

function item(overrides: Partial<OrderItem> & Pick<OrderItem, "id" | "productId" | "productName">): OrderItem {
  return {
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
    orderNumber: "20260101-0001",
    shopId: "shop1",
    orderType: "dineIn",
    channelId: "c1",
    channelName: "หน้าร้าน",
    tableId: "t1",
    tableName: "โต๊ะ 1",
    status: "PAID",
    items: [item({ id: "i1", productId: "p1", productName: "ก๋วยเตี๋ยวหมู" })],
    subtotal: 50,
    discount: 0,
    serviceCharge: 0,
    tax: 0,
    total: 50,
    paymentStatus: "PAID",
    paymentMethodId: "pm1",
    paymentMethodName: "เงินสด",
    cashReceived: 100,
    changeDue: 50,
    createdBy: "u1",
    createdByName: "พนักงาน",
    createdAt: 1000,
    updatedAt: 1000,
    paidAt: 2000,
    ...overrides,
  };
}

test("buildOrderReceipt: includes shop name, order number/table, items, and totals", () => {
  const receipt = buildOrderReceipt(order(), settings());
  const texts = receipt.lines.map((l) => l.text);
  assert.ok(texts.includes("ร้านก๋วยเตี๋ยว"));
  assert.ok(texts.some((t) => t.includes("20260101-0001")));
  assert.ok(texts.some((t) => t.includes("โต๊ะ 1")));
  assert.ok(texts.some((t) => t.includes("ก๋วยเตี๋ยวหมู x1")));
  assert.ok(texts.some((t) => t.includes("ยอดสุทธิ") && t.includes("฿50.00")));
  assert.ok(texts.some((t) => t.includes("เงินสด")));
  assert.ok(texts.some((t) => t.includes("เงินทอน") && t.includes("฿50.00")));
});

test("buildOrderReceipt: shows a non-dine-in order's channel name instead of a table", () => {
  const receipt = buildOrderReceipt(order({ tableId: null, tableName: null, channelName: "สั่งกลับบ้าน" }), settings());
  const texts = receipt.lines.map((l) => l.text);
  assert.ok(texts.includes("สั่งกลับบ้าน"));
  assert.ok(!texts.some((t) => t.startsWith("โต๊ะ")));
});

test("buildOrderReceipt: shows a pickup customerLabel when present", () => {
  const receipt = buildOrderReceipt(order({ customerLabel: "คิว 12" }), settings());
  assert.ok(receipt.lines.some((l) => l.text === "คิว 12"));
});

test("buildOrderReceipt: lists each item's modifiers and note indented under it", () => {
  const withModifiers = order({
    items: [
      item({
        id: "i1",
        productId: "p1",
        productName: "ก๋วยเตี๋ยวหมู",
        note: "ไม่ผัก",
        modifiers: [
          { groupId: "g1", groupName: "เนื้อสัตว์", optionId: "o1", optionName: "หมูสด", priceDelta: 0 },
          { groupId: "g1", groupName: "เนื้อสัตว์", optionId: "o2", optionName: "โครงไก่", priceDelta: 20 },
        ],
      }),
    ],
  });
  const receipt = buildOrderReceipt(withModifiers, settings());
  const texts = receipt.lines.map((l) => l.text);
  assert.ok(texts.some((t) => t.includes("หมูสด") && !t.includes("+")));
  assert.ok(texts.some((t) => t.includes("โครงไก่") && t.includes("+฿20.00")));
  assert.ok(texts.some((t) => t.includes("หมายเหตุ: ไม่ผัก")));
});

test("buildOrderReceipt: omits discount/service charge/VAT lines when they're zero", () => {
  const receipt = buildOrderReceipt(order(), settings());
  const texts = receipt.lines.map((l) => l.text);
  assert.ok(!texts.some((t) => t.startsWith("ส่วนลด")));
  assert.ok(!texts.some((t) => t.startsWith("ค่าบริการ")));
  assert.ok(!texts.some((t) => t.startsWith("ภาษีมูลค่าเพิ่ม")));
});

test("buildOrderReceipt: shows discount/service charge/VAT lines when present", () => {
  const receipt = buildOrderReceipt(
    order({ discount: 10, serviceCharge: 5, tax: 3, subtotal: 50, total: 48 }),
    settings()
  );
  const texts = receipt.lines.map((l) => l.text);
  assert.ok(texts.some((t) => t.includes("ส่วนลด") && t.includes("฿10.00")));
  assert.ok(texts.some((t) => t.includes("ค่าบริการ") && t.includes("฿5.00")));
  assert.ok(texts.some((t) => t.includes("ภาษีมูลค่าเพิ่ม") && t.includes("฿3.00")));
});

test("buildOrderReceipt: appends the footer text only when the shop set one", () => {
  const withFooter = buildOrderReceipt(order(), settings({ receiptFooterText: "ขอบคุณค่ะ" }));
  assert.ok(withFooter.lines.some((l) => l.text === "ขอบคุณค่ะ"));

  const withoutFooter = buildOrderReceipt(order(), settings({ receiptFooterText: "" }));
  assert.ok(!withoutFooter.lines.some((l) => l.text === "ขอบคุณค่ะ"));
});

test("buildOrderReceipt: skips the payment section entirely for an unpaid/still-open order", () => {
  const receipt = buildOrderReceipt(
    order({ paymentMethodName: null, cashReceived: null, changeDue: null }),
    settings()
  );
  assert.ok(!receipt.lines.some((l) => l.text.startsWith("ชำระโดย")));
});
