import { NextResponse } from "next/server";

import { sendTelegramMessage } from "@/lib/notifications/telegram";
import { getServerSession } from "@/lib/auth/session";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { NotificationSettings } from "@/types";

/**
 * "ทดสอบส่งข้อความ" button on the settings page — sends one real message using whatever's
 * already saved (POST /api/admin/notifications must run first), so the admin can confirm the
 * bot token/chat id actually work before relying on it for real bills.
 */
export async function POST() {
  const session = await getServerSession();
  if (!session || session.appUser.role !== "admin") {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
  }

  const db = getAdminDb();
  const shopId = session.appUser.shopId;
  const snap = await db.collection(COLLECTIONS.notificationSettings).doc(shopId).get();
  const settings = snap.exists ? (snap.data() as Omit<NotificationSettings, "id">) : null;

  if (!settings?.telegramBotToken || !settings.telegramChatId) {
    return NextResponse.json({ error: "ยังไม่ได้บันทึก Bot Token / Chat ID" }, { status: 400 });
  }

  // Calls the Telegram API directly rather than `notifyShop` — a test message should work even
  // while the admin still has the `enabled` switch off and is just checking the token/chat id.
  const ok = await sendTelegramMessage(
    settings.telegramBotToken,
    settings.telegramChatId,
    "✅ ทดสอบการแจ้งเตือนจากระบบ POS สำเร็จ"
  );
  if (!ok) {
    return NextResponse.json({ error: "ส่งไม่สำเร็จ ตรวจสอบ Bot Token / Chat ID อีกครั้ง" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
