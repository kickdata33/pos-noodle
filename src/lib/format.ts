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
