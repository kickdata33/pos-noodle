import type { ModifierOption, OrderItemModifier, Product } from "@/types";

/**
 * The name an order line is saved (snapshotted) under — and therefore what the kitchen screen,
 * the check bill, receipts and history all show.
 *
 * Products with a `menuNameBase` get their name from the options picked: base + each distinct
 * `menuNameTag` in pick order, joined with "+". So ก๋วยเตี๋ยว with หมูสด → "ก๋วยเตี๋ยวหมู", with
 * เนื้อเปื่อย → "ก๋วยเตี๋ยวเนื้อ", with both หมูสด and เนื้อเปื่อย → "ก๋วยเตี๋ยวหมู+เนื้อ", and with
 * two pork options still just "ก๋วยเตี๋ยวหมู". If nothing picked carries a tag, the product's
 * normal `name` is used — never a bare base.
 */
export function resolveItemName(
  product: Pick<Product, "name" | "menuNameBase">,
  modifiers: Pick<OrderItemModifier, "optionId">[],
  options: Pick<ModifierOption, "id" | "menuNameTag">[]
): string {
  const base = product.menuNameBase?.trim();
  if (!base) return product.name;
  const tags: string[] = [];
  for (const m of modifiers) {
    const tag = options.find((o) => o.id === m.optionId)?.menuNameTag?.trim();
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags.length > 0 ? `${base}${tags.join("+")}` : product.name;
}
