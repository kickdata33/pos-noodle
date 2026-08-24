import type { EpochMillis, WithId } from "./common";

/** A tenant. One `Shop` doc per business — lets this codebase serve more than one shop later (item 36). */
export interface Shop extends WithId {
  name: string;
  createdAt: EpochMillis;
}

/**
 * All shop-identity / receipt / tax / display config an Admin can edit (item 16).
 * `name` here is the *editable current value*; the string in the spec
 * ("ร้านลูกชิ้นแชมป์ x นายฮังเพ้ง") is only ever used as the seeded default, never hardcoded
 * into a component (item 34).
 */
export interface ShopSettings extends WithId {
  /** Same value as the parent Shop's id — one settings doc per shop. */
  shopId: string;
  name: string;
  logoUrl: string | null;
  phone: string;
  address: string;
  taxId: string;
  /** Free text printed at the bottom of receipts. */
  receiptFooterText: string;
  /** ISO 4217 code, e.g. "THB". */
  currency: string;
  theme: "light" | "dark";
  vatEnabled: boolean;
  /** Percent, e.g. 7 for 7%. */
  vatRate: number;
  serviceChargeEnabled: boolean;
  /** Percent, e.g. 10 for 10%. */
  serviceChargeRate: number;
  updatedAt: EpochMillis;
}
