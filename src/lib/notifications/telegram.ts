import "server-only";

/**
 * Raw fetch against the Telegram Bot API — same "no SDK, plain fetch" style as
 * `lib/billing/omiseClient.ts`. Telegram's API is a simple POST-JSON-get-JSON HTTP endpoint per
 * bot token, so a dependency would buy nothing here.
 *
 * Best-effort by design: every caller in this codebase treats a notification as a courtesy, not
 * part of the transaction it's reporting on (a bill still gets paid whether or not Telegram is
 * reachable) — so this never throws, it returns `false` and lets the caller decide whether that's
 * worth logging.
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
