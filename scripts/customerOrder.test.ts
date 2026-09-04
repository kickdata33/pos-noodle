/**
 * Tests for QR self-order validation/pricing (run: npm run test:pos). This is the security
 * boundary between an anonymous customer's request and what actually gets charged — every case
 * here is "can a customer make this cost the wrong thing".
 */
import assert from "node:assert/strict";
import test from "node:test";

import { resolveCustomerOrder, resolveCustomerOrderItem, type CustomerOrderCatalog } from "../src/lib/pos/customerOrder";
import type { ModifierGroup, ModifierOption, Product } from "../src/types";

function product(overrides: Partial<Product> & Pick<Product, "id" | "price">): Product {
  return {
    shopId: "shop1",
    categoryId: "cat1",
    name: "ก๋วยเตี๋ยวหมู",
    modifierGroupIds: [],
    active: true,
    sortOrder: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function group(overrides: Partial<ModifierGroup> & Pick<ModifierGroup, "id">): ModifierGroup {
  return {
    shopId: "shop1",
    name: "เส้น",
    required: false,
    selectionType: "single",
    active: true,
    sortOrder: 0,
    createdAt: 1,
    ...overrides,
  };
}

function option(overrides: Partial<ModifierOption> & Pick<ModifierOption, "id" | "groupId">): ModifierOption {
  return {
    shopId: "shop1",
    name: "หมี่ขาว",
    priceDelta: 0,
    active: true,
    sortOrder: 0,
    createdAt: 1,
    ...overrides,
  };
}

test("resolveCustomerOrderItem: a plain product with no modifiers prices from the live catalog", () => {
  const catalog: CustomerOrderCatalog = { products: [product({ id: "p1", price: 50 })], modifierGroups: [], modifierOptions: [] };
  const result = resolveCustomerOrderItem({ productId: "p1", quantity: 2, optionIds: [], note: "" }, catalog);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.unitPrice, 50);
    assert.equal(result.item.lineTotal, 100);
  }
});

test("resolveCustomerOrderItem: unknown/inactive product is rejected, never priced at 0", () => {
  const catalog: CustomerOrderCatalog = { products: [product({ id: "p1", price: 50, active: false })], modifierGroups: [], modifierOptions: [] };
  const result = resolveCustomerOrderItem({ productId: "p1", quantity: 1, optionIds: [], note: "" }, catalog);
  assert.equal(result.ok, false);
});

test("resolveCustomerOrderItem: required modifier group with nothing selected is rejected", () => {
  const catalog: CustomerOrderCatalog = {
    products: [product({ id: "p1", price: 50, modifierGroupIds: ["g1"] })],
    modifierGroups: [group({ id: "g1", required: true })],
    modifierOptions: [option({ id: "o1", groupId: "g1" })],
  };
  const result = resolveCustomerOrderItem({ productId: "p1", quantity: 1, optionIds: [], note: "" }, catalog);
  assert.equal(result.ok, false);
});

test("resolveCustomerOrderItem: a single-select group only keeps the first selected option, even if the client sent two", () => {
  const catalog: CustomerOrderCatalog = {
    products: [product({ id: "p1", price: 50, modifierGroupIds: ["g1"] })],
    modifierGroups: [group({ id: "g1", selectionType: "single" })],
    modifierOptions: [option({ id: "o1", groupId: "g1", priceDelta: 5 }), option({ id: "o2", groupId: "g1", priceDelta: 10 })],
  };
  const result = resolveCustomerOrderItem({ productId: "p1", quantity: 1, optionIds: ["o1", "o2"], note: "" }, catalog);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.modifiers.length, 1);
    assert.equal(result.item.lineTotal, 55);
  }
});

test("resolveCustomerOrderItem: an option id from a different product's group is silently ignored, not priced in", () => {
  const catalog: CustomerOrderCatalog = {
    // p1 doesn't offer g1 at all — a tampered request naming g1's option must not apply.
    products: [product({ id: "p1", price: 50, modifierGroupIds: [] })],
    modifierGroups: [group({ id: "g1" })],
    modifierOptions: [option({ id: "o1", groupId: "g1", priceDelta: 999 })],
  };
  const result = resolveCustomerOrderItem({ productId: "p1", quantity: 1, optionIds: ["o1"], note: "" }, catalog);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.modifiers.length, 0);
    assert.equal(result.item.lineTotal, 50);
  }
});

test("resolveCustomerOrderItem: quantity is bounded (rejects 0, negative, non-integer, and absurdly large)", () => {
  const catalog: CustomerOrderCatalog = { products: [product({ id: "p1", price: 50 })], modifierGroups: [], modifierOptions: [] };
  for (const quantity of [0, -1, 1.5, 999]) {
    const result = resolveCustomerOrderItem({ productId: "p1", quantity, optionIds: [], note: "" }, catalog);
    assert.equal(result.ok, false, `quantity ${quantity} should be rejected`);
  }
});

test("resolveCustomerOrderItem: note is trimmed and capped in length", () => {
  const catalog: CustomerOrderCatalog = { products: [product({ id: "p1", price: 50 })], modifierGroups: [], modifierOptions: [] };
  const result = resolveCustomerOrderItem({ productId: "p1", quantity: 1, optionIds: [], note: "  " + "x".repeat(300) }, catalog);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.item.note.length, 200);
});

test("resolveCustomerOrder: collects every line's error instead of stopping at the first", () => {
  const catalog: CustomerOrderCatalog = { products: [product({ id: "p1", price: 50 })], modifierGroups: [], modifierOptions: [] };
  const { items, errors } = resolveCustomerOrder(
    [
      { productId: "p1", quantity: 1, optionIds: [], note: "" },
      { productId: "does-not-exist", quantity: 1, optionIds: [], note: "" },
      { productId: "p1", quantity: -1, optionIds: [], note: "" },
    ],
    catalog
  );
  assert.equal(items.length, 1);
  assert.equal(errors.length, 2);
});
