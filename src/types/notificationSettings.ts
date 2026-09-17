/**
 * Per-shop Telegram notification config — requested by the shop owner
 * ("ต้องการให้แจ้งเตือนรายการต่างๆ ผ่าน telegram ด้วย"): notify on a paid bill, a new
 * bill awaiting review (QR/pickup self-order), a cancelled bill, and a daily 4am summary.
 *
 * Server-only (Admin SDK, `allow read, write: if false` in firestore.rules) — same trust level
 * as `subscriptions`/`billingConfig`. A Telegram bot token is a real credential (whoever has it
 * can post to that chat as the bot), unlike `ShopSettings.receiptPrinterIp`/`promptPayId` which
 * are already client-readable — this must never be readable by ordinary staff via a direct
 * Firestore read, only through `/api/admin/notifications` (which never echoes the token back
 * once saved, only whether one is set).
 */
export interface NotificationSettings {
  /** Same as the shopId — one doc per shop, like `subscriptions`/`shopSettings`. */
  id: string;
  enabled: boolean;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  /**
   * Per-category on/off switches, requested after the first version fired all four
   * unconditionally ("อยากให้เลือกหัวข้อที่จะให้แจ้งเตือนได้"). `undefined` (every doc saved
   * before this existed, or a category simply never touched) must be treated the same as `true`
   * — this feature already went live firing all four, so a missing field must never silently
   * turn one off for a shop that didn't ask for that.
   */
  notifyPaid?: boolean;
  notifyPending?: boolean;
  notifyCancelled?: boolean;
  notifyDailySummary?: boolean;
}
