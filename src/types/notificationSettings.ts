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
  /**
   * Hour of day (0-23, Bangkok local time) to send the daily summary — requested
   * ("สามารถเลือกเวลาสรุปบิลรายวันได้") after it shipped hardcoded to 04:00. `undefined` means
   * 4 (the original default), same "missing = prior behavior" reasoning as the notify* switches
   * above. The cron itself now runs every hour and only actually sends when this hour matches.
   */
  dailySummaryHour?: number;
  /**
   * The Bangkok-local "YYYY-MM-DD" date this shop's summary was last sent for — set right after
   * sending. Since the cron now runs hourly rather than once a day, this is what stops a second
   * run within the same hour (a retry, a manual curl, clock skew) from sending the same day's
   * summary twice; comparing against `undefined` on a shop's very first send is always false, so
   * nothing needs backfilling here.
   */
  lastDailySummaryDateKey?: string;
  /**
   * Turn on the weekly summary (item: "เพิ่มสรุปรายสัปดาห์ ลงใน telegram เพิ่มเติมด้วย") — ยอดขาย/
   * รายรับ/รายจ่าย/กำไร-ขาดทุน over the trailing 7 business days, plus that week's top-5 best
   * sellers. Unlike `notifyPaid`/`notifyPending`/`notifyCancelled`/`notifyDailySummary` above,
   * `undefined` here means **off** — this is a brand-new feature with no shop ever relying on it
   * firing, so (unlike those four, which had to stay backward-compatible with a live "fires
   * unconditionally" behavior) there's no reason to opt every existing shop in by default.
   */
  notifyWeeklySummary?: boolean;
  /**
   * Day of week to send the weekly summary, 0 (Monday) .. 6 (Sunday) — same numbering as
   * `lib/pos/dateRange.ts`'s `bangkokWeekday`. `undefined` means 0 (Monday), the shop owner's
   * confirmed default ("สรุปยอด 7 วันที่ผ่านมา (จันทร์ก่อนหน้าถึงอาทิตย์นี้) ส่งเช้าวันจันทร์เวลา 06:00").
   * Unlike `dailySummaryHour`, this actually works for *any* value the owner picks — the cron
   * that reads it fires once every calendar day, so "is today my chosen weekday" is a reliable
   * check regardless of which day is chosen; only the time-of-day is pinned (piggybacks on the
   * one daily cron fire — see `weeklySummaryCron.ts`'s file comment for why).
   */
  weeklySummaryDayOfWeek?: number;
  /**
   * The Bangkok-local "YYYY-MM-DD" business day the weekly summary's 7-day window last ended on
   * (set right after sending) — stops a second cron run on the same calendar day (a retry, a
   * manual curl) from sending the same week twice. Same dedupe shape as
   * `lastDailySummaryDateKey`, just keyed by week instead of day.
   */
  lastWeeklySummaryWeekKey?: string;
}
