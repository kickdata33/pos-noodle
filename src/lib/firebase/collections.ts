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
} as const;
