"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { categoryRepository } from "@/repositories/categoryRepository";
import { channelRepository } from "@/repositories/channelRepository";
import { modifierGroupRepository, modifierOptionRepository } from "@/repositories/modifierRepository";
import { paymentMethodRepository } from "@/repositories/paymentMethodRepository";
import { productRepository } from "@/repositories/productRepository";
import { shopRepository } from "@/repositories/shopRepository";
import { tableRepository } from "@/repositories/tableRepository";
import type {
  Category,
  ModifierGroup,
  ModifierOption,
  PaymentMethod,
  Product,
  SalesChannel,
  ShopSettings,
  Table,
} from "@/types";

interface PosCatalog {
  /** The signed-in staff member's own shop (from `PosLayout`'s already-verified server session)
   * — every /pos/* screen that needs to write a new doc (a new order, an audit log entry, etc.)
   * should read it from here rather than importing `DEFAULT_SHOP_ID` (item 36: multi-tenant
   * prep — a doc created with the wrong shop's id is exactly the kind of cross-shop leak the
   * Firestore rules are meant to catch, so this should never be wrong in the first place). */
  shopId: string;
  categories: Category[];
  products: Product[];
  modifierGroups: ModifierGroup[];
  modifierOptions: ModifierOption[];
  channels: SalesChannel[];
  tables: Table[];
  paymentMethods: PaymentMethod[];
  settings: ShopSettings | null;
}

const PosCatalogContext = createContext<PosCatalog | null>(null);

/**
 * The shop's catalog/config data (products, categories, modifiers, channels, tables, payment
 * methods, settings) barely changes minute-to-minute, yet `PosHome`, `OrderScreen`, and
 * `StockScreen` each used to subscribe to all of it independently — so every tap from the table
 * grid into an order (or into "ของหมด") tore down and re-established 7+ Firestore listeners from
 * scratch, paying a fresh round-trip for data the previous screen already had a second ago. Felt
 * as real, reported sluggishness on exactly that navigation.
 *
 * Mounted once here at the `/pos` layout level, this provider's subscriptions stay alive across
 * every `/pos/*` navigation (Next.js keeps a shared layout mounted while only the page below it
 * swaps), so opening an order is now just that order doc's own listener — everything else is
 * already in memory. `settings` is a one-time fetch (no live-subscribe method exists on
 * `shopRepository` — it's a single small doc, not worth adding one for), matching every prior
 * caller's behavior; `null` until it resolves, same as those callers' local fallback state did.
 */
export function PosCatalogProvider({ shopId, children }: { shopId: string; children: ReactNode }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [modifierOptions, setModifierOptions] = useState<ModifierOption[]>([]);
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [settings, setSettings] = useState<ShopSettings | null>(null);

  // `shopId` comes from `PosLayout`'s already-verified server session and is never expected to
  // change during one signed-in visit (it isn't reactive UI state, it's an identity), but every
  // effect below still depends on it rather than hardcoding `[]` — the correct, unsurprising
  // thing to do for a value the effect actually reads, and it costs nothing since it never
  // changes in practice.
  useEffect(() => categoryRepository.subscribeForShop(shopId, setCategories), [shopId]);
  useEffect(() => productRepository.subscribeForShop(shopId, setProducts), [shopId]);
  useEffect(() => modifierGroupRepository.subscribeForShop(shopId, setModifierGroups), [shopId]);
  useEffect(() => modifierOptionRepository.subscribeForShop(shopId, setModifierOptions), [shopId]);
  useEffect(() => channelRepository.subscribeForShop(shopId, setChannels), [shopId]);
  useEffect(() => tableRepository.subscribeForShop(shopId, setTables), [shopId]);
  useEffect(() => paymentMethodRepository.subscribeForShop(shopId, setPaymentMethods), [shopId]);
  useEffect(() => {
    shopRepository.getSettings(shopId).then(setSettings);
  }, [shopId]);

  return (
    <PosCatalogContext.Provider
      value={{ shopId, categories, products, modifierGroups, modifierOptions, channels, tables, paymentMethods, settings }}
    >
      {children}
    </PosCatalogContext.Provider>
  );
}

/** Must be used within `/pos/*` — `PosLayout` mounts the one `PosCatalogProvider`. */
export function usePosCatalog(): PosCatalog {
  const ctx = useContext(PosCatalogContext);
  if (!ctx) throw new Error("usePosCatalog must be used within PosCatalogProvider");
  return ctx;
}
