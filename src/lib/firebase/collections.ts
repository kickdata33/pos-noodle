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
  payments: "payments",
  auditLogs: "auditLogs",
} as const;
