import { NextResponse, type NextRequest } from "next/server";

import { getServerSession } from "@/lib/auth/session";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { NotificationSettings } from "@/types";

/**
 * Admin-only view/edit of this shop's Telegram notification settings — a bot token is a real
 * credential (see `notificationSettings.ts`'s comment), so GET never echoes it back, only
 * whether one is currently set. POST leaves the stored token untouched whenever the request
 * omits it (empty/missing `telegramBotToken`), so re-saving the chat id or flipping `enabled`
 * doesn't force the admin to paste the token in again every time.
 */
export async function GET() {
  const session = await getServerSession();
  if (!session || session.appUser.role !== "admin") {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
  }

  const db = getAdminDb();
  const snap = await db.collection(COLLECTIONS.notificationSettings).doc(session.appUser.shopId).get();
  const settings = snap.exists ? (snap.data() as Omit<NotificationSettings, "id">) : null;

  return NextResponse.json({
    enabled: settings?.enabled ?? false,
    telegramChatId: settings?.telegramChatId ?? "",
    hasToken: Boolean(settings?.telegramBotToken),
    // `?? true` — undefined (never touched, or a doc saved before these switches existed) means
    // "on", matching NotificationSettings's documented default.
    notifyPaid: settings?.notifyPaid ?? true,
    notifyPending: settings?.notifyPending ?? true,
    notifyCancelled: settings?.notifyCancelled ?? true,
    notifyDailySummary: settings?.notifyDailySummary ?? true,
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session || session.appUser.role !== "admin") {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
  }

  const body = (await request.json()) as {
    enabled?: boolean;
    telegramBotToken?: string;
    telegramChatId?: string;
    notifyPaid?: boolean;
    notifyPending?: boolean;
    notifyCancelled?: boolean;
    notifyDailySummary?: boolean;
  };

  const db = getAdminDb();
  const shopId = session.appUser.shopId;
  const ref = db.collection(COLLECTIONS.notificationSettings).doc(shopId);

  const update: Record<string, unknown> = {
    enabled: Boolean(body.enabled),
    telegramChatId: body.telegramChatId?.trim() || null,
    notifyPaid: Boolean(body.notifyPaid),
    notifyPending: Boolean(body.notifyPending),
    notifyCancelled: Boolean(body.notifyCancelled),
    notifyDailySummary: Boolean(body.notifyDailySummary),
  };
  // Only overwrite the token when a new non-empty value was actually submitted — see the
  // function comment above.
  if (body.telegramBotToken?.trim()) {
    update.telegramBotToken = body.telegramBotToken.trim();
  }

  await ref.set(update, { merge: true });
  return NextResponse.json({ ok: true });
}
