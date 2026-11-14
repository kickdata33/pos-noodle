import { formatCurrency, formatTime } from "@/lib/format";
import type { Order, OrderItem, ShopSettings } from "@/types";
import { tableLabel } from "@/lib/tableLabel";

/**
 * A printer-agnostic representation of a receipt's content — built once from an `Order` +
 * `ShopSettings`, then handed to whichever printing backend actually talks to hardware
 * (`lib/pos/eposPrint.ts`, today; nothing here assumes Epson/ePOS-Print specifically, so a
 * different printer protocol later only needs its own renderer, not a rewrite of this file).
 */
export type ReceiptAlign = "left" | "center" | "right";

export interface ReceiptLine {
  text: string;
  align?: ReceiptAlign; // default "left"
  bold?: boolean;
  /** 1 = normal size, 2 = double width+height (used for the shop name / total). */
  size?: 1 | 2;
}

export interface Receipt {
  lines: ReceiptLine[];
}

const SEPARATOR = "--------------------------------"; // 32 chars — safe on both 58mm and 80mm

/** e.g. "หมูสด (+฿10.00)" / "หมูสด" when there's no price delta — reused for every modifier line. */
function formatModifierLine(name: string, priceDelta: number, currency: string): string {
  return priceDelta !== 0 ? `  ${name} (+${formatCurrency(priceDelta, currency)})` : `  ${name}`;
}

/** Stable key for `mergeReceiptLines` — two lines combine only when every one of these matches,
 * so a merge never blends anything the printed bill would otherwise show differently. */
function receiptMergeKey(item: OrderItem): string {
  const modifiersKey = item.modifiers
    .map((m) => `${m.groupId}:${m.optionId}:${m.priceDelta}`)
    .sort()
    .join("|");
  return [item.productId, item.unitPrice, item.note, item.bundleUnits ?? 0, modifiersKey].join("::");
}

/**
 * Collapses order lines that would otherwise print as identical repeats — e.g. a customer or
 * staff tapping "โซดาสิงห์" three separate times (three `OrderItem`s, each `quantity: 1`) becomes
 * one printed line "โซดาสิงห์ x3" instead of three "x1" lines (item: "ถ้าของเป็นชนิดเดียวกัน ให้เพิ่ม
 * จำนวนเข้าไป เวลาปริ้น ... ถึงจะกดคนละเวลาก็เถอะ"). **Receipt-only**: this never mutates
 * `order.items` itself or anything read from it elsewhere (the POS cart, kitchen tickets, per-line
 * kitchen status) — those all keep every line exactly as added, timing included; only the printed
 * bill's line list goes through this first. Two lines merge only when product, modifiers, note,
 * `bundleUnits`, and `unitPrice` all match (see `receiptMergeKey`) — a price that changed between
 * the two taps (a time-based special switching over mid-service, say) correctly keeps them apart
 * instead of blending two different prices into one combined line. Order of first appearance is
 * preserved, so the bill's item order doesn't jump around based on merges.
 */
function mergeReceiptLines(items: OrderItem[]): OrderItem[] {
  const merged: OrderItem[] = [];
  const indexByKey = new Map<string, number>();
  for (const item of items) {
    const key = receiptMergeKey(item);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length);
      merged.push(item);
      continue;
    }
    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...existing,
      quantity: existing.quantity + item.quantity,
      lineTotal: existing.lineTotal + item.lineTotal,
    };
  }
  return merged;
}

/**
 * Builds the full printable content for one order's receipt (item: auto-print on checkout, and
 * reprint from Order History). Pure and synchronous — no network, no `Date.now()` beyond what's
 * already snapshotted on `order` — so this is fully unit-testable without a real printer.
 */
export function buildOrderReceipt(
  order: Order,
  settings: ShopSettings,
  options: { title?: string; includeTime?: boolean } = {}
): Receipt {
  const currency = settings.currency;
  const lines: ReceiptLine[] = [];

  lines.push({ text: settings.name, align: "center", bold: true, size: 2 });
  if (settings.address.trim()) lines.push({ text: settings.address.trim(), align: "center" });
  if (settings.phone.trim()) lines.push({ text: `โทร. ${settings.phone.trim()}`, align: "center" });
  if (settings.taxId.trim()) lines.push({ text: `เลขประจำตัวผู้เสียภาษี ${settings.taxId.trim()}`, align: "center" });
  lines.push({ text: SEPARATOR, align: "center" });
  if (options.title) lines.push({ text: options.title, align: "center", bold: true });

  lines.push({ text: `เลขที่ออเดอร์ ${order.orderNumber}` });
  lines.push({ text: order.tableName ? tableLabel(order.tableName) : order.channelName });
  if (order.customerLabel) lines.push({ text: order.customerLabel });
  // A Print Station prints its own local time instead (see `types/printJob.ts`), so check bills
  // pass `includeTime: false`; every existing caller keeps the default.
  if (options.includeTime !== false) lines.push({ text: formatTime(order.paidAt ?? order.createdAt) });
  lines.push({ text: SEPARATOR, align: "center" });

  for (const item of mergeReceiptLines(order.items)) {
    lines.push({ text: `${item.productName} x${item.quantity}` });
    for (const m of item.modifiers) lines.push({ text: formatModifierLine(m.optionName, m.priceDelta, currency) });
    if (item.note) lines.push({ text: `  หมายเหตุ: ${item.note}` });
    lines.push({ text: `  ${formatCurrency(item.lineTotal, currency)}`, align: "right" });
  }
  lines.push({ text: SEPARATOR, align: "center" });

  lines.push({ text: `รวม ${formatCurrency(order.subtotal, currency)}`, align: "right" });
  if (order.discount > 0) {
    const label = order.promoDiscount === order.discount ? "ส่วนลดโปรโมชั่น" : "ส่วนลด";
    lines.push({ text: `${label} -${formatCurrency(order.discount, currency)}`, align: "right" });
  }
  if (order.serviceCharge > 0) {
    lines.push({ text: `ค่าบริการ ${formatCurrency(order.serviceCharge, currency)}`, align: "right" });
  }
  if (order.tax > 0) lines.push({ text: `ภาษีมูลค่าเพิ่ม ${formatCurrency(order.tax, currency)}`, align: "right" });
  lines.push({ text: `ยอดสุทธิ ${formatCurrency(order.total, currency)}`, align: "right", bold: true, size: 2 });

  if (order.paymentMethodName) {
    lines.push({ text: SEPARATOR, align: "center" });
    lines.push({ text: `ชำระโดย ${order.paymentMethodName}` });
    if (order.cashReceived !== null) lines.push({ text: `รับเงิน ${formatCurrency(order.cashReceived, currency)}`, align: "right" });
    if (order.changeDue !== null) lines.push({ text: `เงินทอน ${formatCurrency(order.changeDue, currency)}`, align: "right" });
  }

  if (settings.receiptFooterText.trim()) {
    lines.push({ text: SEPARATOR, align: "center" });
    lines.push({ text: settings.receiptFooterText.trim(), align: "center" });
  }

  return { lines };
}
