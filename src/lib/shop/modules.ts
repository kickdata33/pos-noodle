import type { ShopSettings } from "@/types";

/**
 * The optional Admin modules gated behind `ShopSettings.enabledModules` — everything else in
 * `/admin` (reports, orders, categories, products, modifiers, tables, channels, payment methods,
 * staff, settings) is universal POS core and always available to every shop.
 */
export type ShopModuleKey = "accounting" | "cashSafe" | "delivery" | "payroll";

export type EnabledModules = Record<ShopModuleKey, boolean>;

/** Every module enabled — the default for a shop created before `enabledModules` existed, and
 * what a fresh `scripts/seed.ts` local shop still gets (it isn't the general-signup path). */
export const ALL_MODULES_ENABLED: EnabledModules = {
  accounting: true,
  cashSafe: true,
  delivery: true,
  payroll: true,
};

/** Every module disabled — what every shop provisioned through `/signup` gets explicitly, so a
 * general shop's Admin menu only shows the universal POS core until a superadmin (or the shop's
 * own request) turns a module on. */
export const NO_MODULES_ENABLED: EnabledModules = {
  accounting: false,
  cashSafe: false,
  delivery: false,
  payroll: false,
};

/** Human labels for the superadmin's per-shop module toggles (`/superadmin/subscriptions`). */
export const MODULE_LABELS: Record<ShopModuleKey, string> = {
  accounting: "บัญชีรายรับ-รายจ่าย",
  cashSafe: "ตัดเงินสดออก",
  delivery: "ยอดขาย Delivery",
  payroll: "เงินเดือนพนักงาน",
};

/**
 * Resolves which optional modules a shop actually sees, from its `ShopSettings.enabledModules`
 * (or `undefined`, for a shop that predates the field — see that field's own comment for why
 * `undefined` means "all enabled" rather than "all disabled").
 */
export function resolveEnabledModules(enabledModules: ShopSettings["enabledModules"] | null | undefined): EnabledModules {
  if (!enabledModules) return ALL_MODULES_ENABLED;
  return {
    accounting: enabledModules.accounting ?? false,
    cashSafe: enabledModules.cashSafe ?? false,
    delivery: enabledModules.delivery ?? false,
    payroll: enabledModules.payroll ?? false,
  };
}
