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
  orders: "orders",
  payments: "payments",
  auditLogs: "auditLogs",
} as const;
