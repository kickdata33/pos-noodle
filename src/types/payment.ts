import type { EpochMillis, WithId } from "./common";

/** Admin-managed payment method (item 15) — เงินสด / QR / Delivery / อื่น ๆ. */
export interface PaymentMethod extends WithId {
  shopId: string;
  name: string;
  code: "cash" | "qr" | "delivery" | null;
  active: boolean;
  sortOrder: number;
  createdAt: EpochMillis;
}
