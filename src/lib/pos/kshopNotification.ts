/**
 * Parses the plain-text system notification K SHOP posts to the phone's notification shade every
 * time a QR/PromptPay payment lands (item: "ดักจับข้อความแจ้งเตือน" — no OCR, no bank API, just
 * reading the same text an Android "notification → webhook" forwarder app — MacroDroid, Tasker,
 * "Webhook Push Notifications", etc. — can already capture and POST to
 * `/api/webhooks/kshop-transfer` on its own, with zero cost and no bank onboarding).
 *
 * Confirmed against real notification-shade text from the shop's own phone:
 *   "K SHOP\nได้รับชำระเงิน 100.00 บ. จาก พร้อมเพย์"
 *   "K SHOP\nได้รับชำระเงิน 115.00 บ. จาก น.ส. ชุลาพร"
 * This is the plain-text notification banner, never the rich Flex-message card shown inside the
 * LINE chat itself (that card can't be copied as text — see the accounting page's
 * `TransferQuickAddRow` comment for why this exists instead of a paste-the-card-text feature).
 *
 * Deliberately lenient about what comes before/after the one line that matters: different
 * forwarder apps prefix the notification title, app name, or timestamp onto the text in
 * different ways, so this only ever looks for the "ได้รับชำระเงิน ... บ. จาก ..." fragment
 * anywhere in the string rather than assuming the whole payload is exactly one shape.
 */
export interface ParsedKShopNotification {
  amount: number;
  /** Whoever/whatever the notification says the payment came from — "พร้อมเพย์" when the payer's
   * own bank didn't share a name, otherwise a person's name. Stored as-is in the transfer's note
   * so a human reviewing the log later has the same context the notification gave. */
  payer: string;
}

const PATTERN = /ได้รับชำระเงิน\s*([\d,]+(?:\.\d{1,2})?)\s*บ\.?\s*จาก\s*([^\n\r]+)/;

export function parseKShopNotificationText(text: string): ParsedKShopNotification | null {
  const match = PATTERN.exec(text);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  const payer = match[2].trim();
  if (!Number.isFinite(amount) || amount <= 0 || !payer) return null;
  return { amount, payer };
}
