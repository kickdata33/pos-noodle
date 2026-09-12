/** Central place for Firestore collection names — used by both repositories and firestore.rules docs. */
export const COLLECTIONS = {
  shops: "shops",
  shopSettings: "shopSettings",
  tables: "tables",
  categories: "categories",
  products: "products",
  modifierGroups: "modifierGroups",
  modifierOptions: "modifierOptions",
  salesChannels: "salesChannels",
  paymentMethods: "paymentMethods",
  users: "users",
  /** Server-only: PIN material. Denied to every client in firestore.rules. */
  userSecrets: "userSecrets",
  /** Server-only: failed-PIN throttling counters. Denied to every client. */
  pinAttempts: "pinAttempts",
  orders: "orders",
  /** One doc per shop — the daily-sequence counter behind `generateOrderNumber` (lib/pos). */
  orderCounters: "orderCounters",
  payments: "payments",
  auditLogs: "auditLogs",
  /** Server-only: last-submitted-at per table, for `lib/pos/customerThrottle.ts`. Denied to
   * every client — only the customer QR-order API route (Admin SDK) ever touches this. */
  customerOrderThrottle: "customerOrderThrottle",
  /** Server-only: one doc per shop, the daily pickup-queue counter behind
   * `lib/pos/queueNumberAdmin.ts`. Denied to every client — only the customer pickup-order API
   * route (Admin SDK) ever touches this. */
  pickupQueueCounters: "pickupQueueCounters",
  /** Server-only: prospective shops' signup applications (SaaS roadmap Phase 2). Denied to
   * every client — written by `/api/signup` and reviewed/approved by `/api/superadmin/*`,
   * both Admin SDK. */
  shopSignupRequests: "shopSignupRequests",
  /** Server-only: last-submitted-at per hashed IP, throttling the public `/signup` form against
   * spam the same way `customerOrderThrottle` throttles QR orders. Denied to every client. */
  signupThrottle: "signupThrottle",
  /** Server-only: one doc per shop, the platform billing state (SaaS roadmap Phase 3 — trial/
   * active/past_due/suspended, Omise customer/card ids). Denied to every client, not even the
   * shop's own admin — read/written only via `/api/billing/*`, `/api/superadmin/*`, and
   * `/api/cron/billing`, all Admin SDK. */
  subscriptions: "subscriptions",
  /** Server-only: singleton doc (id "default") holding the platform's trial-days/monthly-price
   * config, editable at runtime from `/superadmin/billing-config` without a redeploy. Denied to
   * every client. */
  billingConfig: "billingConfig",
  /** Server-only: a shop's manual bank-transfer/PromptPay payment submissions (SaaS roadmap
   * Phase 3 bank-transfer alternative to Omise). Written by `/api/billing/slip`, reviewed via
   * `/api/superadmin/subscriptions/[shopId]/slips/[slipId]/*`, all Admin SDK. Denied to every
   * client. */
  paymentSlips: "paymentSlips",
} as const;
