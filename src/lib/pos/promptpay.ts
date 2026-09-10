import generatePayload from "promptpay-qr";

/**
 * The string that goes *into* a PromptPay QR code (Thai QR Payment / EMV QRCPS Merchant
 * Presented Mode standard) — rendering it to an actual scannable image still goes through
 * `qrcode` client-side, same as `TableQrDialog`'s table-ordering QR. Embedding `amount` makes
 * the customer's banking app pre-fill (and for most banks, lock) that exact figure, which is why
 * the pickup order route always passes the order's total here rather than leaving it blank for
 * the customer to type in themselves.
 *
 * Thin wrapper around the `promptpay-qr` npm package (not hand-rolled) — the EMVCo payload
 * format includes a CRC16 checksum, and a financial QR code is not somewhere to risk a
 * transcription bug in a reimplementation of that.
 */
export function generatePromptPayPayload(promptPayId: string, amount: number): string {
  return generatePayload(promptPayId, { amount });
}
