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
  /**
   * True for a line a customer added via QR self-order that staff hasn't seen yet — set by
   * `/api/customer/table/[tableId]/order`, cleared (on every item at once) by `OrderScreen` the
   * moment staff opens this order, same trigger as `Order.pendingReview`. Drives the per-line
   * highlight in the cart list so staff can tell *which* items are the new ones, not just that
   * something changed. Absent (not just `false`) on every item added by staff directly, and on
   * every item from before this feature — every read must treat `undefined` as `false`.
   */
  newSinceReview?: boolean;
  /**
   * True once the kitchen has marked this line as made — toggled from `/pos/kitchen`, per-item
   * (not per-order) since a shop may want to track prep per menu line. Absent (not just `false`)
   * on every item added before this feature, and on every item a customer/staff adds afterward
   * until the kitchen taps it — every read must treat `undefined` the same as `false`.
   */
  prepared?: boolean;
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

  /**
   * How to identify this order's customer at pickup — "คิว 12" or a name they typed in — set
   * only by the self-order takeaway flow (`/api/customer/pickup/order`). `undefined` for every
   * order placed any other way (dine-in, staff-entered takeaway/Grab/etc.) and for every order
   * from before this feature existed — every read must treat that the same as "no label to show".
   */
  customerLabel?: string;
  /**
   * What the customer said they'd do for payment when self-ordering takeaway — purely
   * informational context for staff. The actual checkout, payment method, and `PAID` status
   * still only ever happen through the normal `CheckoutDialog` flow; this never drives anything
   * on its own. `undefined` for every order this feature doesn't apply to.
   */
  pickupPaymentIntent?: "cash" | "transfer";
  /**
   * The customer tapped "แจ้งว่าโอนแล้ว" after scanning the PromptPay QR shown on their own
   * screen — a claim, not a verified fact (there is no bank API integration here). Staff still
   * check their own banking app before confirming payment through `CheckoutDialog`, same as any
   * other transfer; this only drives a "รอตรวจสอบยอดโอน" nudge on the POS side so it isn't missed.
   */
  customerClaimedTransfer?: boolean;
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
