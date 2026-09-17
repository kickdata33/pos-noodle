import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { NotificationSettings } from "@/types";

import { sendTelegramMessage } from "./telegram";

/**
 * Looks up a shop's Telegram settings and sends `text` if notifications are turned on and both
 * the bot token and chat id are set. Every call site in this codebase fires this without
 * `await`-blocking the response it's attached to (an unreachable Telegram API is never worth
 * delaying a customer's order confirmation or a staff member's checkout over) — this function
 * itself never throws, so a bare `void notifyShop(...)` is always safe.
 */
export async function notifyShop(db: Firestore, shopId: string, text: string): Promise<void> {
  try {
    const snap = await db.collection(COLLECTIONS.notificationSettings).doc(shopId).get();
    if (!snap.exists) return;
    const settings = snap.data() as Omit<NotificationSettings, "id">;
    if (!settings.enabled || !settings.telegramBotToken || !settings.telegramChatId) return;
    await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, text);
  } catch {
    // Notifications are a courtesy, never load-bearing — see sendTelegramMessage's comment.
  }
}
