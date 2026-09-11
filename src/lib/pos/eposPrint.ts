import type { Receipt, ReceiptLine } from "./receipt";

/**
 * Talks to a network/LAN thermal printer over Epson's ePOS-Print protocol — a plain HTTP POST of
 * an XML payload straight to the printer's own IP (e.g. TM-m30II, TM-T82III with Ethernet/WiFi),
 * called directly from whatever device is running the POS in its browser. Deliberately chosen
 * over the shop's earlier print-agent pattern (a background service on a dedicated PC
 * subscribing to a Firestore print-job queue) because this shop's POS runs on an Android tablet
 * with no separate computer to host that service on — ePOS-Print needs nothing installed
 * anywhere, only the printer's IP.
 *
 * IMPORTANT — not yet verified against real hardware: this shop hadn't bought a printer yet when
 * this was written, so the exact XML this builds follows Epson's published ePOS-Print XML
 * schema but has never been round-tripped against an actual TM-series printer. Once a real
 * printer is on the network, treat the first print as a smoke test — if formatting looks off,
 * the fix is almost certainly here, not in `receipt.ts` (which just builds content, not markup).
 */

const EPOS_PRINT_NAMESPACE = "http://www.epson-pos.com/schemas/2011/03/epos-print";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * One receipt line becomes one or two `<text>` elements: a mode-setting one only when this
 * line's align/bold/size differs from what's already active (avoids spamming a `<text align=.../>`
 * before every single line), then the actual content element with a trailing newline (`&#10;`) —
 * ePOS-Print prints text as it receives it, so the line feed has to be part of the content itself,
 * not a separate command, or every line would run into the next.
 */
function renderLine(line: ReceiptLine, active: { align: ReceiptAlign; bold: boolean; size: 1 | 2 }): string {
  const align = line.align ?? "left";
  const bold = line.bold ?? false;
  const size = line.size ?? 1;
  let out = "";
  if (align !== active.align) {
    out += `<text align="${align}"/>`;
    active.align = align;
  }
  if (bold !== active.bold) {
    out += `<text em="${bold ? "true" : "false"}"/>`;
    active.bold = bold;
  }
  if (size !== active.size) {
    out += `<text width="${size}" height="${size}"/>`;
    active.size = size;
  }
  out += `<text>${escapeXml(line.text)}&#10;</text>`;
  return out;
}

type ReceiptAlign = "left" | "center" | "right";

/** Pure — no network. Fully unit-testable without a printer, unlike `printReceiptViaEpos` below. */
export function buildEposPrintXml(receipt: Receipt): string {
  const active = { align: "left" as ReceiptAlign, bold: false, size: 1 as 1 | 2 };
  const body = receipt.lines.map((line) => renderLine(line, active)).join("");
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<s:Body>` +
    `<epos-print xmlns="${EPOS_PRINT_NAMESPACE}">` +
    body +
    `<feed line="3"/>` +
    `<cut type="feed"/>` +
    `</epos-print>` +
    `</s:Body>` +
    `</s:Envelope>`
  );
}

/** The standard ePOS-Print endpoint path every TM-series network printer exposes once its
 * "ePOS-Print" web service is turned on in the printer's own setup page. `devid=local_printer`
 * is Epson's documented default logical device name — TM-series printers don't need a different
 * one configured to use it. */
export function buildEposPrintUrl(printerIp: string): string {
  return `http://${printerIp}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`;
}

export interface PrintResult {
  ok: boolean;
  error?: string;
}

/**
 * Fires the actual HTTP request — the one impure piece of this module, deliberately thin so
 * `buildEposPrintXml`/`buildEposPrintUrl` carry all the logic worth unit testing. Never throws:
 * checkout (and reprint) must keep working even when the printer is off, unreachable, or not
 * configured — a failed print is worth telling staff about, never worth blocking the sale over.
 */
export async function printReceiptViaEpos(printerIp: string, receipt: Receipt): Promise<PrintResult> {
  try {
    const response = await fetch(buildEposPrintUrl(printerIp), {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
      body: buildEposPrintXml(receipt),
    });
    if (!response.ok) return { ok: false, error: `เครื่องพิมพ์ตอบกลับผิดปกติ (${response.status})` };
    return { ok: true };
  } catch {
    return { ok: false, error: "เชื่อมต่อเครื่องพิมพ์ไม่ได้ — ตรวจสอบว่าเครื่องพิมพ์เปิดอยู่และต่อเครือข่ายเดียวกัน" };
  }
}
