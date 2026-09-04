/** Shared money formatting — every screen that shows a price should go through this. */
export function formatCurrency(amount: number, currency: string): string {
  try {
    return amount.toLocaleString("th-TH", { style: "currency", currency });
  } catch {
    // Unknown/invalid currency code (e.g. a typo in shopSettings) — fall back to plain number
    // rather than crashing the whole screen over a formatting error.
    return `${amount.toLocaleString("th-TH")} ${currency}`;
  }
}

/** Wall-clock time only (e.g. "14:05") — for "เปิดโต๊ะเมื่อ" on the order screen header and
 * anywhere else showing when *today's* order happened, not a full date. Renders in the viewer's
 * local timezone, same as every other `EpochMillis` display in this app. */
export function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}
