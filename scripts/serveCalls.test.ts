/** Tests for the kitchen "เรียกเสิร์ฟ" rules (run: npm run test:pos). */
import assert from "node:assert/strict";
import test from "node:test";

import { applyServeCall, awaitingServeCall, linesToCall, serveCallLabel, staysOnKitchenScreen } from "../src/lib/pos/serveCalls";
import type { OrderItem } from "../src/types";

const item = (id: string, extra: Partial<OrderItem> = {}): OrderItem => ({
  id,
  productId: "p",
  productName: id,
  quantity: 1,
  unitPrice: 50,
  modifiers: [],
  note: "",
  lineTotal: 50,
  ...extra,
});

test("call sends only lines ticked ทำแล้ว and not yet called", () => {
  const items = [item("a", { prepared: true, preparedAt: 1 }), item("b"), item("c", { prepared: true, preparedAt: 1, serveCalledAt: 2 })];
  assert.deepEqual(linesToCall(items).map((i) => i.id), ["a"]);
});

test("nothing ticked → call sends every line not yet called, and marks them prepared", () => {
  const items = [item("a"), item("b")];
  const lines = linesToCall(items);
  assert.deepEqual(lines.map((i) => i.id), ["a", "b"]);
  const after = applyServeCall(items, lines, 10);
  assert.ok(after.every((i) => i.prepared && i.serveCalledAt === 10 && i.preparedAt === 10));
});

test("lines prepared before the feature existed count as already served", () => {
  const legacy = item("old", { prepared: true });
  assert.equal(awaitingServeCall(legacy), false);
  assert.deepEqual(linesToCall([legacy]), []);
  assert.equal(staysOnKitchenScreen({ items: [legacy] }), false);
});

test("an order stays on the kitchen screen until everything is cooked and called", () => {
  assert.equal(staysOnKitchenScreen({ items: [item("a")] }), true);
  assert.equal(staysOnKitchenScreen({ items: [item("a", { prepared: true, preparedAt: 1 })] }), true);
  assert.equal(staysOnKitchenScreen({ items: [item("a", { prepared: true, preparedAt: 1, serveCalledAt: 2 })] }), false);
});

test("call label", () => {
  assert.equal(serveCallLabel({ tableName: "3", channelName: "หน้าร้าน" }), "โต๊ะ 3");
  assert.equal(serveCallLabel({ tableName: null, channelName: "Grab", customerLabel: "#12" }), "Grab #12");
});
