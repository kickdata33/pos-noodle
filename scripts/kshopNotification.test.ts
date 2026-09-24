/**
 * Tests for parsing K SHOP's plain-text payment notification (run: npm run test:pos).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { parseKShopNotificationText } from "../src/lib/pos/kshopNotification";

test("parseKShopNotificationText: the plain PromptPay case, no payer name shared", () => {
  const parsed = parseKShopNotificationText("K SHOP\nได้รับชำระเงิน 100.00 บ. จาก พร้อมเพย์");
  assert.deepEqual(parsed, { amount: 100, payer: "พร้อมเพย์" });
});

test("parseKShopNotificationText: a named payer", () => {
  const parsed = parseKShopNotificationText("K SHOP\nได้รับชำระเงิน 115.00 บ. จาก น.ส. ชุลาพร");
  assert.deepEqual(parsed, { amount: 115, payer: "น.ส. ชุลาพร" });
});

test("parseKShopNotificationText: tolerates whatever a forwarder app prefixes onto the text", () => {
  // Different notification->webhook apps (MacroDroid, Tasker, ...) template the payload
  // differently — some prepend the app name, sender, or a timestamp. The parser only needs the
  // one fragment that matters, wherever it lands in the string.
  const parsed = parseKShopNotificationText(
    "[06:32] com.kbank.kplus: K SHOP - ได้รับชำระเงิน 1,250.50 บ. จาก นาย อชิรธร"
  );
  assert.deepEqual(parsed, { amount: 1250.5, payer: "นาย อชิรธร" });
});

test("parseKShopNotificationText: unrelated text (a different K SHOP notification, or noise) returns null", () => {
  assert.equal(parseKShopNotificationText("K SHOP\nสรุปยอดขายวันนี้ 5,650 บาท"), null);
  assert.equal(parseKShopNotificationText(""), null);
});
