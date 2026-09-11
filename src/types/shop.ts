import type { EpochMillis, WithId } from "./common";

/** A tenant. One `Shop` doc per business — lets this codebase serve more than one shop later (item 36). */
export interface Shop extends WithId {
  name: string;
  /**
   * URL-safe, unique, lowercase identifier used to route a shop's own subdomain
   * (e.g. `champnoodles-bonkai` → `champnoodles-bonkai.<app domain>`) — see `lib/shop/slug.ts`
   * for the format rules and `lib/shop/shopLookupAdmin.ts` for how a request resolves this back
   * to a `shopId` (SaaS roadmap Phase 2). Every shop has exactly one, assigned at provisioning
   * time and not meant to change casually since it's baked into the shop's public URL/QR codes.
   */
  slug: string;
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
  /**
   * PromptPay ID (phone number or 13-digit tax/citizen ID) the shop actually receives transfers
   * to — the self-order takeaway screen (`/order/pickup`) only offers "โอนพร้อมเพย์" once this is
   * set; "เงินสด" is always offered regardless. `null` until an Admin fills it in.
   */
  promptPayId: string | null;
  /**
   * How `/order/pickup` identifies a customer's order to staff — an auto-issued daily queue
   * number ("คิว 12") or a name the customer types in. Admin-configurable and switchable any
   * time; neither is "more correct", shops just call orders out differently.
   */
  pickupIdentificationMode: "queue" | "name";
  /**
   * IP address (or hostname) of a network/LAN thermal receipt printer that speaks Epson's
   * ePOS-Print protocol (e.g. TM-m30II, TM-T82III with Ethernet/WiFi) — printed to directly over
   * HTTP from whatever device is running the POS (`lib/pos/eposPrint.ts`), no separate print
   * server/agent PC needed. `null`/`undefined` (every shop before this field existed, and any
   * shop that hasn't set one up) means auto-print-on-checkout is simply skipped — checkout must
   * never fail or block just because no printer is configured yet.
   */
  receiptPrinterIp?: string | null;
  updatedAt: EpochMillis;
}
