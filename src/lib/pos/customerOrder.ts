import type { ModifierGroup, ModifierOption, OrderItem, OrderItemModifier, Product, SalesChannel } from "@/types";
import { computeLineTotal, resolveChannelPrice } from "./pricing";

/**
 * Turns one raw selection from the customer-facing QR order screen (`/order/table/[tableId]`)
 * into a real `OrderItem` — the one place that decides what a customer's tap is actually allowed
 * to cost. Deliberately pure and synchronous: the API route (`/api/customer/table/[tableId]/order`)
 * fetches the live `Product`/`ModifierGroup`/`ModifierOption` docs itself via the Admin SDK and
 * passes them in here, so **nothing about price ever comes from the request body** — a customer
 * request can say "productId X, quantity 2, these option ids", never "this costs 40 baht". Kept
 * out of the route handler so this can be unit tested without Firestore.
 */

export interface CustomerSelection {
  productId: string;
  quantity: number;
  optionIds: string[];
  note: string;
}

export interface CustomerOrderCatalog {
  products: Product[];
  modifierGroups: ModifierGroup[];
  modifierOptions: ModifierOption[];
  /**
   * The channel this order is on — QR ordering is dine-in only (see the API route's comment),
   * so this is always the shop's dine-in `SalesChannel`, passed through to `resolveChannelPrice`
   * for consistency with the staff order screen's pricing. Optional only so existing tests that
   * don't care about channel pricing don't need a channel object; the real API route always
   * passes one. Absent behaves exactly as before this field existed — plain `Product.price`.
   */
  channel?: Pick<SalesChannel, "id" | "markupPercent">;
}

export type ResolveResult =
  | { ok: true; item: Omit<OrderItem, "id"> }
  | { ok: false; error: string };

const MAX_QUANTITY_PER_LINE = 30;

export function resolveCustomerOrderItem(
  selection: CustomerSelection,
  catalog: CustomerOrderCatalog
): ResolveResult {
  const product = catalog.products.find((p) => p.id === selection.productId && p.active);
  if (!product) return { ok: false, error: "ไม่พบสินค้านี้ในเมนู" };

  if (!Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > MAX_QUANTITY_PER_LINE) {
    return { ok: false, error: `จำนวนต้องเป็น 1–${MAX_QUANTITY_PER_LINE}` };
  }

  // Only the modifier groups this product actually offers — a selected option id belonging to
  // some other product's group is silently ignored, not trusted, even if the client sent it.
  const groups = product.modifierGroupIds
    .map((id) => catalog.modifierGroups.find((g) => g.id === id && g.active))
    .filter((g): g is ModifierGroup => Boolean(g));

  const modifiers: OrderItemModifier[] = [];
  for (const group of groups) {
    const validOptionIds = new Set(
      catalog.modifierOptions.filter((o) => o.groupId === group.id && o.active).map((o) => o.id)
    );
    let chosen = selection.optionIds.filter((id) => validOptionIds.has(id));
    if (group.selectionType === "single") chosen = chosen.slice(0, 1);

    if (group.required && chosen.length === 0) {
      return { ok: false, error: `กรุณาเลือก "${group.name}"` };
    }

    for (const optionId of chosen) {
      const option = catalog.modifierOptions.find((o) => o.id === optionId)!;
      modifiers.push({
        groupId: group.id,
        groupName: group.name,
        optionId: option.id,
        optionName: option.name,
        priceDelta: option.priceDelta,
      });
    }
  }

  const note = selection.note.trim().slice(0, 200);
  const unitPrice = resolveChannelPrice(product, catalog.channel ?? null);
  const lineTotal = computeLineTotal(unitPrice, modifiers, selection.quantity);

  return {
    ok: true,
    item: {
      productId: product.id,
      productName: product.name,
      quantity: selection.quantity,
      unitPrice,
      modifiers,
      note,
      lineTotal,
    },
  };
}

export interface ResolveAllResult {
  items: Omit<OrderItem, "id">[];
  errors: string[];
}

/** Resolves a whole cart submission, collecting every line's error rather than failing on the
 * first bad one — a customer fixing one mistaken item shouldn't have to re-guess what else was wrong. */
export function resolveCustomerOrder(
  selections: CustomerSelection[],
  catalog: CustomerOrderCatalog
): ResolveAllResult {
  const items: Omit<OrderItem, "id">[] = [];
  const errors: string[] = [];
  for (const selection of selections) {
    const result = resolveCustomerOrderItem(selection, catalog);
    if (result.ok) items.push(result.item);
    else errors.push(result.error);
  }
  return { items, errors };
}
