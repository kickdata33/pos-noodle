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

test("resolveCustomerOrderItem: applies the dine-in channel's markup, same as the staff order screen", () => {
  const catalog: CustomerOrderCatalog = {
    products: [product({ id: "p1", price: 60 })],
    modifierGroups: [],
    modifierOptions: [],
    channel: { id: "dineIn", markupPercent: 20 },
  };
  const result = resolveCustomerOrderItem({ productId: "p1", quantity: 1, optionIds: [], note: "" }, catalog);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.unitPrice, 75); // 60 + 20% = 72, rounds up to nearest 5
    assert.equal(result.item.lineTotal, 75);
  }
});

test("resolveCustomerOrderItem: no channel passed behaves exactly as before — plain product price", () => {
  const catalog: CustomerOrderCatalog = { products: [product({ id: "p1", price: 60 })], modifierGroups: [], modifierOptions: [] };
  const result = resolveCustomerOrderItem({ productId: "p1", quantity: 1, optionIds: [], note: "" }, catalog);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.item.unitPrice, 60);
});

test("resolveCustomerOrderItem: a multi-select group truncates to maxSelect, even if the client sent more", () => {
  const catalog: CustomerOrderCatalog = {
    products: [product({ id: "p1", price: 50, modifierGroupIds: ["g1"] })],
    modifierGroups: [group({ id: "g1", selectionType: "multiple", maxSelect: 2 })],
    modifierOptions: [
      option({ id: "o1", groupId: "g1", priceDelta: 5 }),
      option({ id: "o2", groupId: "g1", priceDelta: 5 }),
      option({ id: "o3", groupId: "g1", priceDelta: 5 }),
    ],
  };
  const result = resolveCustomerOrderItem(
    { productId: "p1", quantity: 1, optionIds: ["o1", "o2", "o3"], note: "" },
    catalog
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.modifiers.length, 2);
    assert.equal(result.item.lineTotal, 60);
  }
});

test("resolveCustomerOrderItem: a multi-select group with no maxSelect stays unlimited (backward-compatible)", () => {
  const catalog: CustomerOrderCatalog = {
    products: [product({ id: "p1", price: 50, modifierGroupIds: ["g1"] })],
    modifierGroups: [group({ id: "g1", selectionType: "multiple" })],
    modifierOptions: [
      option({ id: "o1", groupId: "g1", priceDelta: 5 }),
      option({ id: "o2", groupId: "g1", priceDelta: 5 }),
      option({ id: "o3", groupId: "g1", priceDelta: 5 }),
    ],
  };
  const result = resolveCustomerOrderItem(
    { productId: "p1", quantity: 1, optionIds: ["o1", "o2", "o3"], note: "" },
    catalog
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.item.modifiers.length, 3);
});

test("resolveCustomerOrderItem: a tieredByCount group prices by how many are chosen, not which ones — the meat-topping example", () => {
  const catalog: CustomerOrderCatalog = {
    products: [product({ id: "p1", price: 40, modifierGroupIds: ["g1"] })],
    modifierGroups: [
      group({
        id: "g1",
        name: "เนื้อสัตว์",
        selectionType: "multiple",
        maxSelect: 3,
        pricingMode: "tieredByCount",
        tierPricing: [
          { count: 1, price: 50 },
          { count: 2, price: 50 },
          { count: 3, price: 60 },
        ],
      }),
    ],
    modifierOptions: [
      option({ id: "o1", groupId: "g1", name: "หมู", priceDelta: 0 }),
      option({ id: "o2", groupId: "g1", name: "ไก่", priceDelta: 0 }),
      option({ id: "o3", groupId: "g1", name: "วัว", priceDelta: 0 }),
    ],
  };

  const one = resolveCustomerOrderItem({ productId: "p1", quantity: 1, optionIds: ["o1"], note: "" }, catalog);
  assert.equal(one.ok, true);
  if (one.ok) assert.equal(one.item.lineTotal, 90); // 40 + 50

  const two = resolveCustomerOrderItem({ productId: "p1", quantity: 1, optionIds: ["o1", "o2"], note: "" }, catalog);
  assert.equal(two.ok, true);
  if (two.ok) {
    assert.equal(two.item.lineTotal, 90); // 40 + 50 — same as choosing 1
    // Names of both chosen meats still show up (kitchen/receipt need real names), only the
    // pricing is redistributed — see `distributeTieredPriceDeltas`.
    assert.deepEqual(
      two.item.modifiers.map((m) => m.optionName),
      ["หมู", "ไก่"]
    );
    assert.deepEqual(
      two.item.modifiers.map((m) => m.priceDelta),
      [0, 50]
    );
  }

  const three = resolveCustomerOrderItem(
    { productId: "p1", quantity: 2, optionIds: ["o1", "o2", "o3"], note: "" },
    catalog
  );
  assert.equal(three.ok, true);
  if (three.ok) assert.equal(three.item.lineTotal, 200); // (40 + 60) * 2
});

test("resolveCustomerOrderItem: a tieredByCount group's per-option priceDelta is ignored even if set", () => {
  const catalog: CustomerOrderCatalog = {
    products: [product({ id: "p1", price: 40, modifierGroupIds: ["g1"] })],
    modifierGroups: [
      group({
        id: "g1",
        selectionType: "multiple",
        maxSelect: 1,
        pricingMode: "tieredByCount",
        tierPricing: [{ count: 1, price: 50 }],
      }),
    ],
    // Even a stale/mistaken non-zero priceDelta on the option itself must not add on top of the
    // tier price — the tier price is the whole story in this mode.
    modifierOptions: [option({ id: "o1", groupId: "g1", priceDelta: 999 })],
  };
  const result = resolveCustomerOrderItem({ productId: "p1", quantity: 1, optionIds: ["o1"], note: "" }, catalog);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.item.lineTotal, 90); // 40 + 50, never 40 + 999
});

test("resolveCustomerOrderItem: an option restricted to specific products is only valid on those products", () => {
  const catalog: CustomerOrderCatalog = {
    products: [
      product({ id: "kaoreaw", price: 50 }),
      product({ id: "noodle", price: 40, modifierGroupIds: ["g1"] }),
    ],
    modifierGroups: [group({ id: "g1", name: "เนื้อสัตว์", selectionType: "multiple" })],
    modifierOptions: [
      option({ id: "moo", groupId: "g1", name: "หมูสด" }), // no restriction — shows everywhere
      option({ id: "gai-krong", groupId: "g1", name: "โครงไก่", priceDelta: 20, restrictToProductIds: ["kaoreaw"] }),
    ],
  };

  // "เกาเหลา" also lists g1 — โครงไก่ is explicitly allowed there.
  const kaoreawWithGroup: CustomerOrderCatalog = {
    ...catalog,
    products: [{ ...catalog.products[0], modifierGroupIds: ["g1"] }, catalog.products[1]],
  };
  const onKaoreaw = resolveCustomerOrderItem(
    { productId: "kaoreaw", quantity: 1, optionIds: ["moo", "gai-krong"], note: "" },
    kaoreawWithGroup
  );
  assert.equal(onKaoreaw.ok, true);
  if (onKaoreaw.ok) {
    assert.deepEqual(
      onKaoreaw.item.modifiers.map((m) => m.optionId),
      ["moo", "gai-krong"]
    );
  }

  // "ก๋วยเตี๋ยว" shares the same group g1, but โครงไก่ is restricted to เกาเหลา only — a request
  // that sends its option id anyway (tampered or stale client state) gets it silently dropped,
  // never priced in, exactly like an option id from a different product's group entirely.
  const onNoodle = resolveCustomerOrderItem(
    { productId: "noodle", quantity: 1, optionIds: ["moo", "gai-krong"], note: "" },
    kaoreawWithGroup
  );
  assert.equal(onNoodle.ok, true);
  if (onNoodle.ok) {
    assert.deepEqual(
      onNoodle.item.modifiers.map((m) => m.optionId),
      ["moo"]
    );
    assert.equal(onNoodle.item.lineTotal, 40); // 40 + 0 (โครงไก่'s +20 never applied)
  }
});
