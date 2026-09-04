"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import { categoryRepository } from "@/repositories/categoryRepository";
import { modifierGroupRepository, modifierOptionRepository } from "@/repositories/modifierRepository";
import { productRepository } from "@/repositories/productRepository";
import type { Category, ModifierGroup, ModifierOption, Product } from "@/types";

import { PosBackLink } from "./PosBackLink";

/**
 * Staff-facing "ของหมด" screen — reachable from `/pos` by any signed-in staff/admin (unlike the
 * Admin catalog pages, which are gated to `role === "admin"` and full of edit/price/delete
 * affordances staff shouldn't be reaching for mid-shift). This is deliberately a *different*
 * screen for the *same* underlying `active` flag on `Product`/`ModifierOption` — there's no new
 * "sold out" field: marking something out of stock here is exactly what Admin's "เปิดขาย/ปิดขาย"
 * toggle already does, just exposed with staff-appropriate language ("มีขาย"/"ของหมด") and none
 * of the surrounding CRUD. A product or option someone re-stocks just gets flipped back on here.
 */
export function StockScreen() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [modifierOptions, setModifierOptions] = useState<ModifierOption[]>([]);

  useEffect(() => categoryRepository.subscribeForShop(DEFAULT_SHOP_ID, setCategories), []);
  useEffect(() => productRepository.subscribeForShop(DEFAULT_SHOP_ID, setProducts), []);
  useEffect(() => modifierGroupRepository.subscribeForShop(DEFAULT_SHOP_ID, setModifierGroups), []);
  useEffect(() => modifierOptionRepository.subscribeForShop(DEFAULT_SHOP_ID, setModifierOptions), []);

  async function toggleProduct(product: Product) {
    // Event handler only (invoked from Switch's onCheckedChange below), never during render —
    // the purity rule can't trace that through the inline arrow wrapper, so it's a false positive.
    // eslint-disable-next-line react-hooks/purity
    const updatedAt = Date.now();
    await productRepository.update(product.id, { active: !product.active, updatedAt });
  }

  async function toggleOption(option: ModifierOption) {
    await modifierOptionRepository.update(option.id, { active: !option.active });
  }

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      <PosBackLink />
      <h1 className="mb-1 text-lg font-semibold">ของหมด</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        ปิดเมนู/ตัวเลือกที่ของหมดชั่วคราวได้ที่นี่ — ลูกค้าและพนักงานจะสั่งรายการที่ปิดไม่ได้
        จนกว่าจะเปิดกลับ
      </p>

      {categories.map((category) => {
        const categoryProducts = products.filter((p) => p.categoryId === category.id);
        if (categoryProducts.length === 0) return null;
        return (
          <section key={category.id} className="mb-5">
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">{category.name}</h2>
            <div className="grid gap-2">
              {categoryProducts.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{product.name}</span>
                    <Badge variant={product.active ? "success" : "muted"}>
                      {product.active ? "มีขาย" : "ของหมด"}
                    </Badge>
                  </div>
                  <Switch checked={product.active} onCheckedChange={() => toggleProduct(product)} />
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {modifierGroups.map((group) => {
        const groupOptions = modifierOptions.filter((o) => o.groupId === group.id);
        if (groupOptions.length === 0) return null;
        return (
          <section key={group.id} className="mb-5">
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">ตัวเลือก: {group.name}</h2>
            <div className="grid gap-2">
              {groupOptions.map((option) => (
                <div
                  key={option.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{option.name}</span>
                    <Badge variant={option.active ? "success" : "muted"}>
                      {option.active ? "มีขาย" : "ของหมด"}
                    </Badge>
                  </div>
                  <Switch checked={option.active} onCheckedChange={() => toggleOption(option)} />
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {products.length === 0 && modifierOptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">ยังไม่มีเมนู — ไปเพิ่มที่หน้า Admin ก่อน</p>
      ) : null}
    </main>
  );
}
