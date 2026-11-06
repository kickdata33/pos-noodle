/** Tests for option-driven line names (run: npm run test:pos). */
import assert from "node:assert/strict";
import test from "node:test";

import { resolveItemName } from "../src/lib/pos/itemName";
import { groupItemsByProduct } from "../src/lib/pos/pricing";
import type { OrderItem } from "../src/types";

const options = [
  { id: "pork", menuNameTag: "หมู" },
  { id: "porkball", menuNameTag: "หมู" },
  { id: "beef", menuNameTag: "เนื้อ" },
  { id: "noodle", menuNameTag: null },
];
const noodle = { name: "ก๋วยเตี๋ยวหมู / เนื้อ", menuNameBase: "ก๋วยเตี๋ยว" };
const pick = (...ids: string[]) => ids.map((optionId) => ({ optionId }));

test("pork pick → ก๋วยเตี๋ยวหมู, beef pick → ก๋วยเตี๋ยวเนื้อ", () => {
  assert.equal(resolveItemName(noodle, pick("noodle", "pork"), options), "ก๋วยเตี๋ยวหมู");
  assert.equal(resolveItemName(noodle, pick("beef"), options), "ก๋วยเตี๋ยวเนื้อ");
});

test("two pork options don't repeat the tag; mixed meats join with +", () => {
  assert.equal(resolveItemName(noodle, pick("pork", "porkball"), options), "ก๋วยเตี๋ยวหมู");
  assert.equal(resolveItemName(noodle, pick("pork", "beef"), options), "ก๋วยเตี๋ยวหมู+เนื้อ");
});

test("no tagged pick, or no base set → the product's own name", () => {
  assert.equal(resolveItemName(noodle, pick("noodle"), options), "ก๋วยเตี๋ยวหมู / เนื้อ");
  assert.equal(resolveItemName({ name: "ชาเย็น" }, pick("pork"), options), "ชาเย็น");
  assert.equal(resolveItemName({ name: "ชาเย็น", menuNameBase: "  " }, pick("pork"), options), "ชาเย็น");
});

test("cart groups the same product separately by line name", () => {
  const line = (id: string, productName: string): OrderItem => ({
    id,
    productId: "p",
    productName,
    quantity: 1,
    unitPrice: 50,
    modifiers: [],
    note: "",
    lineTotal: 50,
  });
  const groups = groupItemsByProduct([line("a", "ก๋วยเตี๋ยวหมู"), line("b", "ก๋วยเตี๋ยวเนื้อ"), line("c", "ก๋วยเตี๋ยวหมู")]);
  assert.deepEqual(
    groups.map((g) => [g.productName, g.totalQty]),
    [["ก๋วยเตี๋ยวหมู", 2], ["ก๋วยเตี๋ยวเนื้อ", 1]]
  );
});

test("top sellers list ก๋วยเตี๋ยวหมู and ก๋วยเตี๋ยวเนื้อ as separate rows", async () => {
  const { topProducts } = await import("../src/lib/pos/reports");
  const item = (productName: string, quantity: number): OrderItem => ({
    id: productName + quantity,
    productId: "p",
    productName,
    quantity,
    unitPrice: 50,
    modifiers: [],
    note: "",
    lineTotal: 50 * quantity,
  });
  const rows = topProducts([{ items: [item("ก๋วยเตี๋ยวหมู", 3), item("ก๋วยเตี๋ยวเนื้อ", 1)] } as never]);
  assert.deepEqual(
    rows.map((r) => [r.productName, r.qty]),
    [["ก๋วยเตี๋ยวหมู", 3], ["ก๋วยเตี๋ยวเนื้อ", 1]]
  );
});
