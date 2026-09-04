import type { EpochMillis, WithId } from "./common";

export type OrderStatus = "OPEN" | "PAID" | "CANCELLED" | "VOID";
export type OrderPaymentStatus = "UNPAID" | "PAID";

/** A single chosen modifier option, snapshotted onto the order item at add-time (item 12). */
export interface OrderItemModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDelta: number;
}

/**
 * One line in an order (item 21 `items`). Product name/price are snapshotted at the moment
 * the item is added, so later Admin edits to `Product` never change historical orders.
 */
export interface OrderItem extends WithId {
  productId: string;
  productName: string;
  quantity: number;
  /** Unit price at time of adding (base price + any channel override), before modifiers. */
  unitPrice: number;
  modifiers: OrderItemModifier[];
  note: string;
  /** (unitPrice + sum of modifier priceDelta) * quantity. */
  lineTotal: number;
}

/**
 * item 21. `orderType` distinguishes dine-in (has a `tableId`) from all other channels;
 * `channelId` always points at a `SalesChannel` doc so the label shown anywhere in the UI
 * comes from data, never a hardcoded string (item 34).
 */
export interface Order extends WithId {
  orderNumber: string;
  shopId: string;

  orderType: "dineIn" | "other";
  channelId: string;
  /** Snapshot of the channel name at order-open time, for fast list rendering. */
  channelName: string;
  tableId: string | null;
  /** Snapshot of the table name at order-open time. Null for non-dine-in orders. */
  tableName: string | null;

  status: OrderStatus;
  items: OrderItem[];

  subtotal: number;
  discount: number;
  serviceCharge: number;
  tax: number;
  total: number;

  paymentStatus: OrderPaymentStatus;
  paymentMethodId: string | null;
  paymentMethodName: string | null;
  cashReceived: number | null;
  changeDue: number | null;

  createdBy: string;
  createdByName: string;
  createdAt: EpochMillis;
  updatedAt: EpochMillis;
  paidAt: EpochMillis | null;

  /**
   * True while this order has QR self-order items staff hasn't seen yet — set by
   * `/api/customer/table/[tableId]/order` whenever a customer submits, cleared by `OrderScreen`
   * the moment staff actually opens this order. Drives the badge + alert sound on the `/pos`
   * table grid (`PosHome`). Absent (not just `false`) on every order from before this feature —
   * every read of it must treat `undefined` the same as `false`, never assume the field exists.
   */
  pendingReview?: boolean;
}

/** A completed payment against an order — kept even if the order later gets refunded/voided. */
export interface Payment extends WithId {
  orderId: string;
  shopId: string;
  paymentMethodId: string;
  paymentMethodName: string;
  amount: number;
  cashReceived: number | null;
  changeDue: number | null;
  createdBy: string;
  createdAt: EpochMillis;
}
