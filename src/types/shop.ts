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
   * A photo of the shop's own static K SHOP QR sticker (the exact same QR code already taped to
   * the counter for walk-in customers), stored as a compressed data URL the same way
   * `BillingConfig.qrCodeImage` is — item: "ตั้ง QR code สั่งกลับบ้านให้เป็นตัวเดียวกันกับ kshop".
   * When set, `/order/pickup`'s "โอนเงิน" option shows this image byte-for-byte instead of
   * generating a *different* QR from `promptPayId` — the whole point being that every QR
   * payment, walk-in or pickup, lands through the exact same K SHOP sticker/account, so the
   * reconciliation numbers this app already tracks (`lib/pos/reconciliation.ts`) never have to
   * account for two separate QR sources. `promptPayId`-based dynamic generation is kept as the
   * fallback for a shop that hasn't uploaded this yet — see `/api/customer/pickup/order`'s
   * comment on `promptPayPayload` for exactly when each path is used.
   */
  paymentQrImageUrl: string | null;
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
  /**
   * Days of the month (1–31) the shop is normally closed every month (item: "กำหนดวันหยุดร้านได้") —
   * defaults to `[1, 16]`, the shop's confirmed usual rest days (coincides with, but is a
   * separate concept from, the payroll "ตัดจ่าย" cutoff dates in `lib/pos/payroll.ts`). Read
   * together with per-date exceptions in the `shopClosedDates` collection
   * (`types/shopClosedDate.ts`) via `isShopClosedDay`/`closedDateKeysInRange`
   * (`lib/pos/shopCalendar.ts`) — a closed day excludes from payroll wage accrual for every
   * enrolled employee at once. `undefined` (every shop before this field existed) is treated as
   * the same `[1, 16]` default by every reader, so nothing needs a one-time migration.
   */
  closedDaysOfMonth?: number[];
  /**
   * Which optional Admin modules this shop has turned on, beyond the universal POS core that
   * every shop always gets (reports, orders, categories, products, modifiers, tables, channels,
   * payment methods, staff, settings). `accounting`/`cashSafe`/`delivery`/`payroll` were all
   * built for this app's original shop's own exact workflow (its K SHOP wallet, its Grab/LINE
   * MAN/ShopeeFood reconciliation, its payday dates) — a general shop signing up through
   * `/signup` doesn't bank with K SHOP or do delivery, so those menus would just be noise.
   * `undefined` means "this shop existed before this field did" and is treated as every module
   * enabled (`lib/shop/modules.ts`'s `resolveEnabledModules`) so nothing had to be migrated when
   * this shipped. Every shop provisioned from now on gets this explicitly set to all-`false`;
   * a superadmin can turn any module back on per shop from `/superadmin/subscriptions`.
   */
  enabledModules?: {
    accounting: boolean;
    cashSafe: boolean;
    delivery: boolean;
    payroll: boolean;
  };
  updatedAt: EpochMillis;
}

/** `ShopSettings.closedDaysOfMonth`'s default when a shop hasn't customized it yet — the shop's
 * confirmed usual rest days. Exported so every reader (payroll page, settings UI, tests) falls
 * back to the exact same default rather than each hardcoding `[1, 16]` separately. */
export const DEFAULT_CLOSED_DAYS_OF_MONTH: number[] = [1, 16];
