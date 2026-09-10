"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
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
export function PosCatalogProvider({ children }: { children: ReactNode }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [modifierOptions, setModifierOptions] = useState<ModifierOption[]>([]);
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [settings, setSettings] = useState<ShopSettings | null>(null);

  useEffect(() => categoryRepository.subscribeForShop(DEFAULT_SHOP_ID, setCategories), []);
  useEffect(() => productRepository.subscribeForShop(DEFAULT_SHOP_ID, setProducts), []);
  useEffect(() => modifierGroupRepository.subscribeForShop(DEFAULT_SHOP_ID, setModifierGroups), []);
  useEffect(() => modifierOptionRepository.subscribeForShop(DEFAULT_SHOP_ID, setModifierOptions), []);
  useEffect(() => channelRepository.subscribeForShop(DEFAULT_SHOP_ID, setChannels), []);
  useEffect(() => tableRepository.subscribeForShop(DEFAULT_SHOP_ID, setTables), []);
  useEffect(() => paymentMethodRepository.subscribeForShop(DEFAULT_SHOP_ID, setPaymentMethods), []);
  useEffect(() => {
    shopRepository.getSettings(DEFAULT_SHOP_ID).then(setSettings);
  }, []);

  return (
    <PosCatalogContext.Provider
      value={{ categories, products, modifierGroups, modifierOptions, channels, tables, paymentMethods, settings }}
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
