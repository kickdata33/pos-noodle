import type { EpochMillis, WithId } from "./common";

/** Significant actions that must be traceable (item 18). */
export type AuditAction =
  | "ORDER_ITEM_REMOVED"
  | "ORDER_CANCELLED"
  | "ORDER_VOID"
  | "ORDER_AMOUNT_CHANGED"
  | "ORDER_DISCOUNT_APPLIED"
  | "ORDER_REFUNDED"
  | "ORDER_PAID";

/** Preset reasons offered when removing an item after an order has been saved (item 19). */
export type AuditReason = "กดผิด" | "ลูกค้ายกเลิก" | "ทำผิด" | "อื่น ๆ";

export interface AuditLog extends WithId {
  shopId: string;
  action: AuditAction;
  orderId: string | null;
  /** Human-readable summary, e.g. `ลบ "ก๋วยเตี๋ยวน้ำตก 60 บาท"`. */
  description: string;
  reason: AuditReason | null;
  /** Free text when reason is "อื่น ๆ", or extra context for any action. */
  reasonNote: string | null;
  performedBy: string;
  performedByName: string;
  createdAt: EpochMillis;
}
