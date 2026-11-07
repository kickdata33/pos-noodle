import { formatCurrency } from "@/lib/format";
import { generatePromptPayPayload } from "@/lib/pos/promptpay";
import { buildOrderReceipt, type ReceiptLine } from "@/lib/pos/receipt";
import type { Order, OrderItem, PrintJob, ShopSettings } from "@/types";

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
  /** `items` with every line's `kitchenSentQty` brought up to (or down to) its `quantity`. */
  updatedItems: OrderItem[];
}

/**
 * What the kitchen hasn't heard about yet: for each line, `quantity - kitchenSentQty`. Positive
 * goes on the ticket as new food; negative (staff lowered a quantity after it was sent) goes on
 * as a cancellation. Returns `null` when the kitchen is already up to date, so callers can skip
 * writing anything at all.
 */
export function computeKitchenSend(items: OrderItem[]): KitchenSend | null {
  const added: KitchenLine[] = [];
  const cancelled: KitchenLine[] = [];
  for (const item of items) {
    const delta = item.quantity - (item.kitchenSentQty ?? 0);
    if (delta > 0) added.push({ item, quantity: delta });
    else if (delta < 0) cancelled.push({ item, quantity: -delta });
  }
  if (added.length === 0 && cancelled.length === 0) return null;
  const updatedItems = items.map((i) => (i.kitchenSentQty === i.quantity ? i : { ...i, kitchenSentQty: i.quantity }));
  return { added, cancelled, updatedItems };
}

/** Number of portions not yet sent to the kitchen — drives the "ส่งครัว (N)" button. */
export function countUnsentToKitchen(items: OrderItem[]): number {
  return items.reduce((sum, i) => sum + Math.max(0, i.quantity - (i.kitchenSentQty ?? 0)), 0);
}

type OrderHeader = Pick<Order, "orderNumber" | "tableName" | "channelName" | "customerLabel">;

/** "โต๊ะ 3" for dine-in, otherwise the channel ("Grab", "กลับบ้าน คิว 12"). */
export function kitchenDestinationLabel(order: OrderHeader): string {
  if (order.tableName) return `โต๊ะ ${order.tableName}`;
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
 * Kitchen ticket: big destination, no prices (the cook doesn't need them, and small type next
 * to a price is how orders get misread). `round` is the ticket's sequence number on this order.
 */
export function buildKitchenTicketLines(order: OrderHeader, send: Pick<KitchenSend, "added" | "cancelled">, round: number): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  const onlyCancel = send.added.length === 0;
  lines.push({ text: onlyCancel ? "*** ยกเลิกรายการ ***" : `ใบสั่งครัว รอบที่ ${round}`, align: "center", bold: true });
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

/** Fields of a kitchen job — the caller adds `shopId`/`createdBy`/`createdAt` (and the id). */
export function kitchenJobFields(
  order: OrderHeader & { id: string },
  send: Pick<KitchenSend, "added" | "cancelled">,
  round: number
): Pick<PrintJob, "station" | "kind" | "orderId" | "lines" | "qrPayload" | "qrCaption" | "status" | "claimedBy" | "error" | "printedAt"> {
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
    { text: `โต๊ะ ${input.tableName}`, align: "center", bold: true, size: 2 },
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
