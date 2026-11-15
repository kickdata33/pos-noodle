import { formatCurrency } from "@/lib/format";
import { generatePromptPayPayload } from "@/lib/pos/promptpay";
import { buildOrderReceipt, type ReceiptLine } from "@/lib/pos/receipt";
import type { Order, OrderItem, PrintJob, ShopSettings } from "@/types";
import { tableLabel } from "@/lib/tableLabel";

/**
 * Pure builders for Print Station jobs (`types/printJob.ts`) — no Firestore, no `Date.now()`, so
 * both the POS (client SDK) and the customer QR-order API routes (Admin SDK) share exactly the
 * same ticket content, and everything here is unit-tested in `scripts/printTickets.test.ts`.
 */

const SEPARATOR = "--------------------------------";

export interface KitchenLine {
  item: OrderItem;
  quantity: number;
}

export interface KitchenSend {
  added: KitchenLine[];
  cancelled: KitchenLine[];
  /** `items` with every line's sent-quantity field (`kitchenSentQty` or `barSentQty`, whichever
   * this send was for) brought up to (or down to) its `quantity`. Only that one field ever
   * changes here — a kitchen send can never touch `barSentQty` and vice versa, so sending to one
   * station can never make the other station think it's already caught up on lines it hasn't
   * actually printed yet. */
  updatedItems: OrderItem[];
}

/** One station's view of a line: whether it belongs there at all, and how much of it that
 * station has already printed. `computeKitchenSend`/`computeBarSend` and
 * `countUnsentToKitchen`/`countUnsentToBar` are thin wrappers around the shared logic below, each
 * passing its own station's fields — so the two stations' "already sent" bookkeeping can never
 * cross-contaminate (see `updatedItems`'s comment). */
interface StationFields {
  belongsHere(item: OrderItem): boolean;
  sentQty(item: OrderItem): number;
  withSentQty(item: OrderItem, qty: number): OrderItem;
}

const KITCHEN_FIELDS: StationFields = {
  // `Category.sendToKitchen === false` (see that field's comment) — this line never goes on a
  // kitchen ticket at all, added or cancelled, regardless of its `kitchenSentQty`.
  belongsHere: (item) => item.sendToKitchen !== false,
  sentQty: (item) => item.kitchenSentQty ?? 0,
  withSentQty: (item, qty) => ({ ...item, kitchenSentQty: qty }),
};

const BAR_FIELDS: StationFields = {
  // Opt-in, the other way round from kitchen (see `Category.sendToBar`'s comment) — a line only
  // goes to the bar when its category was explicitly routed there.
  belongsHere: (item) => item.sendToBar === true,
  sentQty: (item) => item.barSentQty ?? 0,
  withSentQty: (item, qty) => ({ ...item, barSentQty: qty }),
};

/**
 * What a station hasn't heard about yet: for each of its lines, `quantity - sentQty`. Positive
 * goes on the ticket as new food/drinks; negative (staff lowered a quantity after it was sent)
 * goes on as a cancellation. Returns `null` when the station is already up to date, so callers
 * can skip writing anything at all.
 */
function computeStationSend(items: OrderItem[], fields: StationFields): KitchenSend | null {
  const added: KitchenLine[] = [];
  const cancelled: KitchenLine[] = [];
  for (const item of items) {
    if (!fields.belongsHere(item)) continue;
    const delta = item.quantity - fields.sentQty(item);
    if (delta > 0) added.push({ item, quantity: delta });
    else if (delta < 0) cancelled.push({ item, quantity: -delta });
  }
  if (added.length === 0 && cancelled.length === 0) return null;
  // Scoped to this station's own lines — a line that isn't this station's (`belongsHere` false)
  // is left completely untouched, never given a stray sentQty it was never asked for. Besides
  // being tidier data, this is what keeps the two stations' bookkeeping from ever being able to
  // cross-contaminate even if a future station reused a shared field name by mistake.
  const updatedItems = items.map((i) => {
    if (!fields.belongsHere(i)) return i;
    return fields.sentQty(i) === i.quantity ? i : fields.withSentQty(i, i.quantity);
  });
  return { added, cancelled, updatedItems };
}

function countUnsentForStation(items: OrderItem[], fields: StationFields): number {
  return items.reduce((sum, i) => (fields.belongsHere(i) ? sum + Math.max(0, i.quantity - fields.sentQty(i)) : sum), 0);
}

export function computeKitchenSend(items: OrderItem[]): KitchenSend | null {
  return computeStationSend(items, KITCHEN_FIELDS);
}

export function computeBarSend(items: OrderItem[]): KitchenSend | null {
  return computeStationSend(items, BAR_FIELDS);
}

/** Number of portions not yet sent to the kitchen — drives the "ส่งครัว (N)" button. Lines whose
 * category opts out of kitchen tickets (`sendToKitchen === false`) never count here either. */
export function countUnsentToKitchen(items: OrderItem[]): number {
  return countUnsentForStation(items, KITCHEN_FIELDS);
}

/** Same as `countUnsentToKitchen`, for the drink-bar station — drives the "ส่งบาร์ (N)" button. */
export function countUnsentToBar(items: OrderItem[]): number {
  return countUnsentForStation(items, BAR_FIELDS);
}

type OrderHeader = Pick<Order, "orderNumber" | "tableName" | "channelName" | "customerLabel">;

/** "โต๊ะ 3" for dine-in, otherwise the channel ("Grab", "กลับบ้าน คิว 12"). */
export function kitchenDestinationLabel(order: OrderHeader): string {
  if (order.tableName) return tableLabel(order.tableName);
  return order.customerLabel ? `${order.channelName} ${order.customerLabel}` : order.channelName;
}

function itemLines(entry: KitchenLine, sign: "" | "-"): ReceiptLine[] {
  const lines: ReceiptLine[] = [
    { text: `${sign}${entry.quantity} x ${entry.item.productName}`, bold: true, size: 2 },
  ];
  for (const m of entry.item.modifiers) lines.push({ text: `   - ${m.optionName}` });
  if (entry.item.note) lines.push({ text: `   ** ${entry.item.note}`, bold: true });
  return lines;
}

/**
 * Shared layout for both the kitchen and bar tickets: big destination, no prices (the cook/bar
 * doesn't need them, and small type next to a price is how orders get misread). `round` is the
 * ticket's sequence number on this order, `ticketTitle` the big first line's non-cancel text
 * ("ใบสั่งครัว"/"ใบสั่งบาร์น้ำ").
 */
function buildStationTicketLines(
  order: OrderHeader,
  send: Pick<KitchenSend, "added" | "cancelled">,
  round: number,
  ticketTitle: string
): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  const onlyCancel = send.added.length === 0;
  lines.push({ text: onlyCancel ? "*** ยกเลิกรายการ ***" : `${ticketTitle} รอบที่ ${round}`, align: "center", bold: true });
  lines.push({ text: kitchenDestinationLabel(order), align: "center", bold: true, size: 2 });
  lines.push({ text: `เลขที่ ${order.orderNumber}`, align: "center" });
  lines.push({ text: SEPARATOR, align: "center" });
  for (const entry of send.added) lines.push(...itemLines(entry, ""));
  if (send.cancelled.length > 0) {
    if (!onlyCancel) {
      lines.push({ text: SEPARATOR, align: "center" });
      lines.push({ text: "*** ยกเลิก ***", align: "center", bold: true });
    }
    for (const entry of send.cancelled) lines.push(...itemLines(entry, "-"));
  }
  return lines;
}

export function buildKitchenTicketLines(order: OrderHeader, send: Pick<KitchenSend, "added" | "cancelled">, round: number): ReceiptLine[] {
  return buildStationTicketLines(order, send, round, "ใบสั่งครัว");
}

/** Same layout as the kitchen ticket, titled for the drink-bar station instead. */
export function buildBarTicketLines(order: OrderHeader, send: Pick<KitchenSend, "added" | "cancelled">, round: number): ReceiptLine[] {
  return buildStationTicketLines(order, send, round, "ใบสั่งบาร์น้ำ");
}

type StationJobFields = Pick<
  PrintJob,
  "station" | "kind" | "orderId" | "lines" | "qrPayload" | "qrCaption" | "status" | "claimedBy" | "error" | "printedAt"
>;

/** Fields of a kitchen job — the caller adds `shopId`/`createdBy`/`createdAt` (and the id). */
export function kitchenJobFields(
  order: OrderHeader & { id: string },
  send: Pick<KitchenSend, "added" | "cancelled">,
  round: number
): StationJobFields {
  return {
    station: "kitchen",
    kind: "kitchen",
    orderId: order.id,
    lines: buildKitchenTicketLines(order, send, round),
    qrPayload: null,
    qrCaption: null,
    status: "pending",
    claimedBy: null,
    error: null,
    printedAt: null,
  };
}

/** Same as `kitchenJobFields`, for the drink-bar station. */
export function barJobFields(
  order: OrderHeader & { id: string },
  send: Pick<KitchenSend, "added" | "cancelled">,
  round: number
): StationJobFields {
  return {
    station: "bar",
    kind: "bar",
    orderId: order.id,
    lines: buildBarTicketLines(order, send, round),
    qrPayload: null,
    qrCaption: null,
    status: "pending",
    claimedBy: null,
    error: null,
    printedAt: null,
  };
}

/**
 * Check bill for the cashier printer: the normal receipt layout titled "ใบแจ้งค่าอาหาร", plus a
 * PromptPay QR with the exact total embedded when the shop has a PromptPay ID — the customer's
 * banking app fills in (and for most banks locks) the amount, so nobody types it by hand.
 */
export function checkBillJobFields(
  order: Order,
  settings: ShopSettings
): Pick<PrintJob, "station" | "kind" | "orderId" | "lines" | "qrPayload" | "qrCaption" | "status" | "claimedBy" | "error" | "printedAt"> {
  const receipt = buildOrderReceipt(order, settings, { title: "ใบแจ้งค่าอาหาร (ยังไม่ชำระ)", includeTime: false });
  const promptPayId = settings.promptPayId?.trim();
  const withQr = Boolean(promptPayId) && order.total > 0;
  return {
    station: "cashier",
    kind: "checkBill",
    orderId: order.id,
    lines: receipt.lines,
    qrPayload: withQr ? generatePromptPayPayload(promptPayId!, order.total) : null,
    qrCaption: withQr ? `สแกนจ่ายพร้อมเพย์ ${formatCurrency(order.total, settings.currency)}` : null,
    status: "pending",
    claimedBy: null,
    error: null,
    printedAt: null,
  };
}

/**
 * Self-order QR slip for one table (item: "ปริ้น QR ให้ลูกค้าสั่งเอง") — printed at the cashier
 * station and handed to the customer. `url` is the table's ordering link, including the one-time
 * session token when the table uses `qrMode: "session"`; the slip then says it only works for
 * this visit, so customers don't keep it for later.
 */
export function tableQrJobFields(
  input: { shopName: string; tableName: string; url: string; sessionMode: boolean }
): Pick<PrintJob, "station" | "kind" | "orderId" | "lines" | "qrPayload" | "qrCaption" | "status" | "claimedBy" | "error" | "printedAt"> {
  const lines: ReceiptLine[] = [
    { text: input.shopName, align: "center", bold: true },
    { text: tableLabel(input.tableName), align: "center", bold: true, size: 2 },
    { text: "สแกนเพื่อสั่งอาหาร", align: "center", bold: true },
    { text: "สั่งเพิ่มได้ตลอด รายการเข้าบิลโต๊ะนี้ทันที", align: "center" },
  ];
  return {
    station: "cashier",
    kind: "tableQr",
    orderId: "",
    lines,
    qrPayload: input.url,
    qrCaption: input.sessionMode ? "QR นี้ใช้ได้จนกว่าจะเช็คบิล" : "เปิดกล้องมือถือแล้วสแกน",
    status: "pending",
    claimedBy: null,
    error: null,
    printedAt: null,
  };
}

/**
 * Paid receipt for the cashier station — exactly the receipt layout the Epson path already
 * prints (`buildOrderReceipt`), so both printers produce the same document. The time line is
 * left to the station (`includeTime: false`), like every other queued ticket.
 */
export function receiptJobFields(
  order: Order,
  settings: ShopSettings
): Pick<PrintJob, "station" | "kind" | "orderId" | "lines" | "qrPayload" | "qrCaption" | "status" | "claimedBy" | "error" | "printedAt"> {
  return {
    station: "cashier",
    kind: "receipt",
    orderId: order.id,
    lines: buildOrderReceipt(order, settings, { includeTime: false }).lines,
    qrPayload: null,
    qrCaption: null,
    status: "pending",
    claimedBy: null,
    error: null,
    printedAt: null,
  };
}

/** Deterministic id for an order's automatic receipt job — see `payOrder.confirmPaymentOnce`. */
export function autoReceiptJobId(orderId: string): string {
  return `receipt-${orderId}`;
}
