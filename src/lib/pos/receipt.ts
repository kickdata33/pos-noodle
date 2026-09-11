import { formatCurrency, formatTime } from "@/lib/format";
import type { Order, ShopSettings } from "@/types";

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

/**
 * Builds the full printable content for one order's receipt (item: auto-print on checkout, and
 * reprint from Order History). Pure and synchronous — no network, no `Date.now()` beyond what's
 * already snapshotted on `order` — so this is fully unit-testable without a real printer.
 */
export function buildOrderReceipt(order: Order, settings: ShopSettings): Receipt {
  const currency = settings.currency;
  const lines: ReceiptLine[] = [];

  lines.push({ text: settings.name, align: "center", bold: true, size: 2 });
  if (settings.address.trim()) lines.push({ text: settings.address.trim(), align: "center" });
  if (settings.phone.trim()) lines.push({ text: `โทร. ${settings.phone.trim()}`, align: "center" });
  if (settings.taxId.trim()) lines.push({ text: `เลขประจำตัวผู้เสียภาษี ${settings.taxId.trim()}`, align: "center" });
  lines.push({ text: SEPARATOR, align: "center" });

  lines.push({ text: `เลขที่ออเดอร์ ${order.orderNumber}` });
  lines.push({ text: order.tableName ? `โต๊ะ ${order.tableName}` : order.channelName });
  if (order.customerLabel) lines.push({ text: order.customerLabel });
  lines.push({ text: formatTime(order.paidAt ?? order.createdAt) });
  lines.push({ text: SEPARATOR, align: "center" });

  for (const item of order.items) {
    lines.push({ text: `${item.productName} x${item.quantity}` });
    for (const m of item.modifiers) lines.push({ text: formatModifierLine(m.optionName, m.priceDelta, currency) });
    if (item.note) lines.push({ text: `  หมายเหตุ: ${item.note}` });
    lines.push({ text: `  ${formatCurrency(item.lineTotal, currency)}`, align: "right" });
  }
  lines.push({ text: SEPARATOR, align: "center" });

  lines.push({ text: `รวม ${formatCurrency(order.subtotal, currency)}`, align: "right" });
  if (order.discount > 0) lines.push({ text: `ส่วนลด -${formatCurrency(order.discount, currency)}`, align: "right" });
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
